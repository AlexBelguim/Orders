import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import * as api from '../lib/api';
import { euro } from '../lib/format';
import { aggregateOrderItems } from '../lib/menu';

const API = import.meta.env.VITE_API_URL || '';

export default function DispatchPage() {
  const [active, setActive] = useState<any[]>([]);
  const [done, setDone] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [pending, setPending] = useState(0);
  const [showDone, setShowDone] = useState(false);
  // Manual reordering of active cards (by order id). Preserved across auto-refresh.
  const [positions, setPositions] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    const [d, a] = await Promise.all([api.getDispatchOrders(), api.getAgents()]);
    setActive(d.active); setDone(d.done); setAgents(a);
    setPending(0);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Socket: auto-refresh on changes (dispatch needs to be live), preserving manual order.
  useEffect(() => {
    const sock = io(API, { transports: ['websocket', 'polling'] });
    let t: any = null;
    const schedule = () => {
      setPending((c) => c + 1);
      // debounce: collapse a burst of events into one refresh
      if (t) clearTimeout(t);
      t = setTimeout(async () => { await refresh(); }, 400);
    };
    sock.on('newOrder', schedule);
    sock.on('dispatchUpdated', schedule);
    sock.on('orderUpdated', schedule);
    return () => { sock.disconnect(); if (t) clearTimeout(t); };
  }, [refresh]);

  // Re-apply manual positions after a refresh, appending any new orders at the end.
  const orderedActive = (() => {
    if (!positions.length) return active;
    const byId = new Map(active.map((o) => [o.id, o]));
    const seen = new Set<number>();
    const out: any[] = [];
    for (const id of positions) { const o = byId.get(id); if (o) { out.push(o); seen.add(id); } }
    for (const o of active) if (!seen.has(o.id)) out.push(o);
    return out;
  })();

  const move = (orderId: number, dir: -1 | 1) => {
    const idx = orderedActive.findIndex((o) => o.id === orderId);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= orderedActive.length) return;
    const a = orderedActive[idx].id, b = orderedActive[swap].id;
    setPositions((p) => {
      // rebuild positions from current visible order, then swap
      const base = orderedActive.map((o) => o.id);
      [base[idx], base[swap]] = [b, a];
      return base;
    });
  };

  const assign = async (orderId: number, agentId: number) => { await api.assignAgent(orderId, agentId); await refresh(); };
  const unassign = async (orderId: number) => { await api.unassignAgent(orderId); await refresh(); };
  const status = async (orderId: number, s: string) => { await api.setOrderStatus(orderId, s); await refresh(); };
  const pickup = async (orderId: number) => { await api.markPickup(orderId); await refresh(); };

  return (
    <div className="prep-screen dispatch">
      <div className="prep-header">
        <h1>🛵 Bezorg-dispatch</h1>
        <span className="chip">Leveringen</span>
        <div className="spacer" />
        <a href="/admin" className="chip">← Beheer</a>
        <button onClick={refresh}>↻ Vernieuw</button>
      </div>

      {pending > 0 && (
        <div className="new-banner" style={{ background: 'var(--success)', cursor: 'default' }}>
          <span>↻ Updaten…</span>
          <span className="muted">live</span>
        </div>
      )}

      {orderedActive.length === 0 && <div className="card"><p className="muted">Geen open leveringen.</p></div>}

      <div className="ticket-grid">
        {orderedActive.map((o) => (
          <DispatchCard
            key={o.id}
            order={o}
            agents={agents}
            onAssign={assign}
            onUnassign={unassign}
            onPickup={pickup}
            onStatus={status}
            onMove={move}
          />
        ))}
        {showDone && done.map((o) => (
          <DispatchCard key={o.id} order={o} agents={agents} onAssign={() => {}} onUnassign={() => {}} onPickup={() => {}} onStatus={() => {}} done />
        ))}
      </div>

      {done.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowDone(!showDone)}>{showDone ? '▲' : '▼'} Afgerond vandaag ({done.length})</button>
        </div>
      )}
    </div>
  );
}

function DispatchCard({ order, agents, onAssign, onUnassign, onPickup, onStatus, onMove, done }: {
  order: any; agents: any[];
  onAssign: (orderId: number, agentId: number) => void;
  onUnassign: (orderId: number) => void;
  onPickup: (orderId: number) => void;
  onStatus: (orderId: number, status: string) => void;
  onMove?: (orderId: number, dir: -1 | 1) => void;
  done?: boolean;
}) {
  const lines = aggregateOrderItems(order.items || []);
  const total = (order.items || []).reduce((s: number, it: any) => s + (it.unitPriceCents || 0) * it.qty, 0);
  const assignment = order.assignment;
  const assignedAgentId = assignment?.agentId ?? null;
  const when = new Date(order.createdAt);
  const minsAgo = Math.max(0, Math.floor((Date.now() - when.getTime()) / 60000));

  const statusLabel: Record<string, string> = {
    NEW: 'Nieuw', IN_PREP: 'In bereiding', READY: 'Klaar', ASSIGNED: 'Bezorger toegewezen',
    PICKED_UP: 'Opgehaald', ON_THE_WAY: 'Onderweg', DELIVERED: 'Geleverd', CANCELLED: 'Geannuleerd', BUSY: 'Bezig',
  };

  return (
    <div className={`ticket dispatch-card ${done ? 'done' : ''}`}>
      <div className="ticket-head">
        <div>
          <div className="title">#{order.id} — {order.customerName}</div>
          <div className="time">
            {order.location?.name}{order.tableLabel ? ` • tafel ${order.tableLabel}` : ''} • {when.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} ({minsAgo} min)
          </div>
        </div>
        {!done && onMove && (
          <div className="row">
            <button className="circle small" onClick={() => onMove(order.id, -1)}>←</button>
            <button className="circle small" onClick={() => onMove(order.id, 1)}>→</button>
          </div>
        )}
        <span className="status-badge" style={{ background: 'var(--primary)', color: '#fff', fontSize: 11 }}>{statusLabel[order.status] || order.status}</span>
      </div>

      <div className="ticket-body">
        <div className="contact-row">
          {order.customerPhone && <a className="chip primary" href={`tel:${order.customerPhone}`}>📞 {order.customerPhone}</a>}
          {order.tableLabel && <span className="chip">Tafel {order.tableLabel}</span>}
        </div>

        {lines.map((l, i) => (
          <div key={i} className="ticket-item">
            <span className="qty">{l.qty}×</span>
            <span className="label">{l.label}</span>
            <span></span>
            {!!l.choices.length && <div className="choices">{l.choices.map((c, j) => <div key={j}>↳ {c.menuName}: {c.optionName || 'geen'}</div>)}</div>}
            {l.note && <div className="choices" style={{ color: 'var(--warning)' }}>↳ {l.note}</div>}
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontWeight: 600 }}>
          <span>Totaal</span><span>{euro(total)}</span>
        </div>
        {order.payMethod && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{order.payMethod === 'ONLINE' ? 'Online betaald' : 'Betalen bij levering'}</div>}
        {order.note && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>📝 {order.note}</div>}
      </div>

      {!done && (
        <div className="ticket-actions col" style={{ gap: 6 }}>
          <div className="row">
            <select value={assignedAgentId ?? ''} onChange={(e) => e.target.value && onAssign(order.id, Number(e.target.value))} style={{ flex: 1 }}>
              <option value="">{assignedAgentId ? '↻ Her_toewijzen…' : 'Bezorger toewijzen…'}</option>
              {agents.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {assignedAgentId && <button className="danger" onClick={() => onUnassign(order.id)}>Ontkoppel</button>}
          </div>
          {assignment && (
            <div className="row" style={{ fontSize: 12 }}>
              <span className="muted">Bezorger: <strong>{assignment.agent?.name}</strong> ({assignment.agent?.code})</span>
              <a href={`/bezorger/${assignment.agent?.code}`} className="chip" target="_blank" rel="noreferrer">open ↗</a>
            </div>
          )}
          <div className="row">
            {order.status !== 'ON_THE_WAY' && order.status !== 'PICKED_UP' && <button onClick={() => onPickup(order.id)}>🛵 Onderweg</button>}
            <button className="success" onClick={() => onStatus(order.id, 'DELIVERED')}>✓ Geleverd</button>
            <button className="danger" onClick={() => onStatus(order.id, 'CANCELLED')}>✕ Annuleer</button>
          </div>
        </div>
      )}
    </div>
  );
}
