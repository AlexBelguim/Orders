import { Router } from 'express';
import prisma from '../db.js';
import { io } from '../index.js';

// Statuses where a delivery order is still relevant for dispatch.
const DISPATCH_ACTIVE = ['NEW', 'IN_PREP', 'READY', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'BUSY'];

export default function dispatchRouter() {
  const r = Router();

  // ---- Assignment ----

  // Assign (or reassign) an agent to an order.
  r.post('/orders/:id/assign', async (req, res) => {
    const orderId = Number(req.params.id);
    const agentId = Number((req.body as any)?.agentId);
    if (!Number.isFinite(agentId)) return res.status(400).json({ error: 'agentId required' });
    const [order, agent] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.deliveryAgent.findUnique({ where: { id: agentId } }),
    ]);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (!agent) return res.status(404).json({ error: 'agent not found' });

    // Upsert assignment (orderId is unique) — reassign replaces agent.
    const assignment = await prisma.deliveryAssignment.upsert({
      where: { orderId },
      update: { agentId, assignedAt: new Date(), pickedUpAt: null, status: 'ASSIGNED' },
      create: { orderId, agentId, status: 'ASSIGNED' },
    });
    await prisma.order.update({ where: { id: orderId }, data: { assignedAgentId: agentId, status: 'ASSIGNED' } });
    io.emit('dispatchUpdated', { orderId, agentId });
    io.emit('orderUpdated', { orderId, status: 'ASSIGNED' });
    res.json(assignment);
  });

  // Unassign.
  r.post('/orders/:id/unassign', async (req, res) => {
    const orderId = Number(req.params.id);
    await prisma.deliveryAssignment.deleteMany({ where: { orderId } });
    await prisma.order.update({ where: { id: orderId }, data: { assignedAgentId: null } });
    io.emit('dispatchUpdated', { orderId, agentId: null });
    res.json({ ok: true });
  });

  // Agent marks picked up → order is on the way (customer sees "onderweg").
  r.post('/orders/:id/pickup', async (req, res) => {
    const orderId = Number(req.params.id);
    const assignment = await prisma.deliveryAssignment.update({
      where: { orderId },
      data: { pickedUpAt: new Date(), status: 'PICKED_UP' },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: 'ON_THE_WAY' } });
    io.emit('orderUpdated', { orderId, status: 'ON_THE_WAY' });
    io.emit('dispatchUpdated', { orderId, agentId: assignment.agentId });
    res.json(assignment);
  });

  // List delivery orders relevant for dispatch (active + today's delivered).
  r.get('/orders', async (_req, res) => {
    const all = await prisma.order.findMany({
      where: { deliveryMode: 'DELIVERY' },
      orderBy: { createdAt: 'desc' },
      include: {
        location: true,
        assignment: { include: { agent: true } },
        items: { include: { variant: { include: { product: true } } } },
      },
    });
    const today = new Date().toDateString();
    const active = all.filter((o) => DISPATCH_ACTIVE.includes(o.status));
    const done = all.filter((o) => (o.status === 'DELIVERED' || o.status === 'CANCELLED') && new Date(o.createdAt).toDateString() === today);
    res.json({ active, done });
  });

  // ---- Positions ----

  // Customer shares location (keyed by cancel token, public).
  r.post('/orders/by-token/:token/position', async (req, res) => {
    const order = await prisma.order.findUnique({ where: { cancelToken: req.params.token } });
    if (!order) return res.status(404).json({ error: 'order not found' });
    const lat = Number((req.body as any)?.lat);
    const lon = Number((req.body as any)?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const accuracy = (req.body as any)?.accuracy != null ? Number((req.body as any).accuracy) : null;
    const ping = await prisma.positionPing.create({
      data: { orderId: order.id, lat, lon, accuracy: Number.isFinite(accuracy) ? accuracy : null, source: 'CUSTOMER' },
    });
    io.emit('positionUpdate', { orderId: order.id, source: 'CUSTOMER', lat, lon, accuracy: ping.accuracy });
    res.json({ ok: true });
  });

  // Agent streams position (keyed by agent code, public).
  r.post('/agents/:code/position', async (req, res) => {
    const agent = await prisma.deliveryAgent.findUnique({ where: { code: req.params.code } });
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    const lat = Number((req.body as any)?.lat);
    const lon = Number((req.body as any)?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const accuracy = (req.body as any)?.accuracy != null ? Number((req.body as any).accuracy) : null;
    const heading = (req.body as any)?.heading != null ? Number((req.body as any).heading) : null;
    // orderId optional: if omitted, attach to the agent's current active assignment.
    let orderId = (req.body as any)?.orderId != null ? Number((req.body as any).orderId) : null;
    if (!orderId) {
      const active = await prisma.deliveryAssignment.findFirst({
        where: { agentId: agent.id, status: { in: ['ASSIGNED', 'PICKED_UP'] } },
        orderBy: { assignedAt: 'desc' },
      });
      orderId = active?.orderId ?? null;
    }
    if (!orderId) return res.json({ ok: false, reason: 'no active assignment' });
    const ping = await prisma.positionPing.create({
      data: {
        orderId, lat, lon,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        heading: Number.isFinite(heading) ? heading : null,
        source: 'AGENT',
      },
    });
    io.emit('positionUpdate', { orderId, source: 'AGENT', lat, lon, accuracy: ping.accuracy, heading: ping.heading });
    res.json({ ok: true, orderId });
  });

  // Latest customer + agent positions for an order (map bootstrap).
  r.get('/orders/:id/positions', async (req, res) => {
    const orderId = Number(req.params.id);
    const recent = await prisma.positionPing.findMany({
      where: { orderId, recordedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });
    const latestAgent = recent.find((p) => p.source === 'AGENT');
    const latestCustomer = recent.find((p) => p.source === 'CUSTOMER');
    const agentTrail = recent.filter((p) => p.source === 'AGENT').reverse();
    res.json({ latestAgent, latestCustomer, agentTrail });
  });

  // Agent phone page: ALL active assignments (a bezorger may carry multiple).
  r.get('/agents/:code/active-orders', async (req, res) => {
    const agent = await prisma.deliveryAgent.findUnique({ where: { code: req.params.code } });
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    const assignments = await prisma.deliveryAssignment.findMany({
      where: {
        agentId: agent.id,
        status: { in: ['ASSIGNED', 'PICKED_UP'] },
        order: { status: { notIn: ['DELIVERED', 'DONE', 'CANCELLED'] } },
      },
      orderBy: { assignedAt: 'asc' },
      include: { order: { include: { location: true, items: { include: { variant: { include: { product: true } } } } } } },
    });
    // Attach each order's latest customer position.
    const result = [];
    for (const a of assignments) {
      const customerPing = await prisma.positionPing.findFirst({
        where: { orderId: a.orderId, source: 'CUSTOMER' },
        orderBy: { recordedAt: 'desc' },
      });
      result.push({ assignment: a, customerPing });
    }
    res.json({ items: result });
  });

  // Agent phone page: single active order (legacy, kept for compat).
  r.get('/agents/:code/active-order', async (req, res) => {
    const agent = await prisma.deliveryAgent.findUnique({ where: { code: req.params.code } });
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: {
        agentId: agent.id,
        status: { in: ['ASSIGNED', 'PICKED_UP'] },
        // Defensive: never surface an order that's already terminal
        order: { status: { notIn: ['DELIVERED', 'DONE', 'CANCELLED'] } },
      },
      orderBy: { assignedAt: 'desc' },
      include: { order: { include: { location: true, items: { include: { variant: { include: { product: true } } } } } } },
    });
    if (!assignment) return res.json({ assignment: null });
    // also fetch the customer's latest shared position for this order
    const customerPing = await prisma.positionPing.findFirst({
      where: { orderId: assignment.orderId, source: 'CUSTOMER' },
      orderBy: { recordedAt: 'desc' },
    });
    res.json({ assignment, customerPing });
  });

  return r;
}
