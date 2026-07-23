import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import * as api from '../lib/api';
import { aggregateOrderItems, aggregateAppendToEnd, screenPauseState, nextAt } from '../lib/menu';
import TimeInput from '../components/TimeInput';

const API = import.meta.env.VITE_API_URL || '';

// Active = ticket stays on the screen.
const STATUSES_ACTIVE = ['NEW', 'IN_PREP', 'READY', 'BUSY', 'ON_THE_WAY', 'ASSIGNED', 'PICKED_UP'];

// Item status cycle: PENDING → PREPARING → DONE → PENDING (so a fat-finger can roll back).
const NEXT_STATUS: Record<string, string> = { PENDING: 'PREPARING', PREPARING: 'DONE', DONE: 'PENDING' };

export default function PrepScreenPage() {
  const { slug } = useParams();
  const [screen, setScreen] = useState<any | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [doneTickets, setDoneTickets] = useState<any[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [live, setLive] = useState(false); // brief "synced" flash indicator
  const [positions, setPositions] = useState<number[]>([]); // manual ordering (order ids)
  const [showOnWay, setShowOnWay] = useState(true);
  // Confirmation modals for "Geleverd" / "Annuleer" — prevent fat-finger taps
  // (cancelling now also triggers an irreversible refund for paid orders).
  // Must stay above the early `if (!screen) return` below: hooks can never be
  // called conditionally, or the hook count changes between renders (React #310).
  const [confirmDeliver, setConfirmDeliver] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  // Rush pause: "Pauzeer" picker modal + a 30s tick so the scheduled window
  // flips the header state without a reload.
  const [showPause, setShowPause] = useState(false);
  const [pauseCustom, setPauseCustom] = useState('');
  const [, setPauseTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPauseTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const screenRef = useRef<any>(null);
  screenRef.current = screen;

  const loadScreen = useCallback(async () => {
    const screens = await api.getPrepScreens();
    const s = screens.find((x: any) => x.slug === slug);
    if (!s) return;
    setScreen(s);
    await refresh(s);
  }, [slug]);

  const belongs = useCallback((o: any, sc: any) => {
    if (!sc) return false;
    if (o.location?.coordinatorScreenId === sc.id) return true; // coordinator always shows
    const screenItems = (o.items || []).filter((it: any) => it.prepScreenId === sc.id);
    if (screenItems.length === 0) return false;
    if (screenItems.some((it: any) => it.itemStatus !== 'DONE')) return true;
    // All our items are done. If a coordinator screen exists for this order's
    // location, finalizing is its job — we can drop it. Otherwise WE are the
    // only screen and nobody else will ever click "Bestelling klaar", so keep
    // showing the ticket (button included) until the order itself is
    // actually finalized — otherwise it gets stuck at BUSY/IN_PREP forever,
    // invisible to staff, and never counted in stats.
    if (o.location?.coordinatorScreenId) return false;
    const finalized = ['READY', 'DONE', 'DELIVERED', 'CANCELLED', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'].includes(o.status);
    return !finalized;
  }, []);

  const refresh = useCallback(async (s?: any) => {
    const sc = s || screenRef.current;
    if (!sc) return;
    const [all, a] = await Promise.all([api.getOrders({ status: 'ALL' }), api.getAgents()]);
    const today = new Date().toDateString();
    // Does this order involve our screen at all (we coordinate it, or it has items routed here)?
    const involves = (o: any) =>
      o.location?.coordinatorScreenId === sc.id || (o.items || []).some((it: any) => it.prepScreenId === sc.id);
    const active = all.filter((o: any) => STATUSES_ACTIVE.includes(o.status) && belongs(o, sc));
    const activeIds = new Set(active.map((o: any) => o.id));
    // Completed-for-this-screen: it involves us, it's from today, not cancelled, and it has
    // already left our active lane. That now also includes sub-orders whose items we've all
    // marked done while the bigger order is still live — so a mis-tapped "klaar" can be found
    // and rolled back here instead of vanishing.
    const done = all.filter((o: any) =>
      involves(o) && o.status !== 'CANCELLED' && !activeIds.has(o.id) &&
      new Date(o.createdAt).toDateString() === today
    );
    setAgents(a);
    setTickets(active);
    setDoneTickets(done);
    setLive(true);
    setTimeout(() => setLive(false), 600);
  }, [belongs]);

  useEffect(() => { loadScreen(); }, [loadScreen]);

  // Auto-refresh: append new orders to the right, preserve existing positions,
  // and update item status live. No manual refresh needed.
  useEffect(() => {
    const sock = io(API, { transports: ['websocket', 'polling'] });
    let t: any = null;
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => refresh(), 350);
    };
    sock.on('newOrder', schedule);
    sock.on('orderUpdated', schedule);
    sock.on('itemUpdated', schedule);
    sock.on('dispatchUpdated', schedule);
    // Pause toggled from another device (admin, other tablet) — reload our row.
    sock.on('screenUpdated', (s: any) => {
      if (s && s.id === screenRef.current?.id) setScreen((cur: any) => cur ? { ...cur, ...s } : cur);
    });
    return () => { sock.disconnect(); if (t) clearTimeout(t); };
  }, [refresh]);

  if (!screen) return <div className="prep-screen"><div className="card"><p className="muted">Scherm laden…</p></div></div>;

  const sortedTickets = applyPositions(tickets, positions);

  const move = (orderId: number, dir: -1 | 1) => {
    const idx = sortedTickets.findIndex((t) => t.id === orderId);
    if (idx < 0) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= sortedTickets.length) return;
    const base = sortedTickets.map((t) => t.id);
    [base[idx], base[swapWith]] = [base[swapWith], base[idx]];
    setPositions(base);
  };

  const setStatus = async (orderId: number, status: string) => { await api.setOrderStatus(orderId, status); await refresh(); };
  const cycleItem = async (orderId: number, itemId: number, current: string) => {
    const next = NEXT_STATUS[current] || 'PREPARING';
    // Auto-set the order to BUSY if it's still NEW — tapping any item means work has started.
    const order = tickets.find((t) => t.id === orderId);
    if (order && order.status === 'NEW') {
      await api.setOrderStatus(orderId, 'BUSY');
    }
    await api.setItemStatus(orderId, itemId, next);
    await refresh();
  };

  // Quick-mode screens (e.g. Bar) skip per-item tracking: one tap marks every
  // item for this screen done and finalizes the order in one go — mirrors the
  // normal "mark item done" + "Bestelling klaar" flow, just batched.
  const quickComplete = async (orderId: number, itemIds: number[], deliveryMode: string) => {
    await Promise.all(itemIds.map((itemId) => api.setItemStatus(orderId, itemId, 'DONE')));
    await api.setOrderStatus(orderId, deliveryMode === 'EAT_IN' ? 'DONE' : 'READY');
    await refresh();
  };
  const quickReopen = async (orderId: number, itemIds: number[]) => {
    await Promise.all(itemIds.map((itemId) => api.setItemStatus(orderId, itemId, 'PENDING')));
    await refresh();
  };

  const confirmDelivered = async () => {
    if (confirmDeliver == null) return;
    const oid = confirmDeliver;
    setConfirmDeliver(null);
    await setStatus(oid, 'DELIVERED');
  };

  const confirmCancelled = async () => {
    if (confirmCancel == null) return;
    const oid = confirmCancel;
    setConfirmCancel(null);
    await setStatus(oid, 'CANCELLED');
  };

  // Coordinator: assign a bezorger + start delivery
  const assignAgent = async (orderId: number, agentId: number) => { await api.assignAgent(orderId, agentId); await refresh(); };
  const sendOnWay = async (orderId: number, agentId: number | null) => {
    if (agentId) await api.assignAgent(orderId, agentId);
    await api.markPickup(orderId);
    await refresh();
  };

  // ----- Rush pause ("Pauzeer" / "Hervat") -----
  const pauseState = screenPauseState(screen);
  const doPause = async (until: Date) => {
    const updated = await api.updatePrepScreen(screen.id, { pauseOverridePaused: true, pauseOverrideUntil: until.toISOString() });
    setScreen(updated); setShowPause(false); setPauseCustom('');
  };
  const doResume = async () => {
    const ovUntil = screen.pauseOverrideUntil ? new Date(screen.pauseOverrideUntil) : null;
    const manualActive = !!(ovUntil && ovUntil.getTime() > Date.now() && screen.pauseOverridePaused);
    // Manual pause → just clear it. Scheduled pause → force-open until the
    // window would have ended anyway (tomorrow's window runs normally again).
    const payload = manualActive
      ? { pauseOverridePaused: false, pauseOverrideUntil: null }
      : { pauseOverridePaused: false, pauseOverrideUntil: nextAt(screen.pauseUntil)?.toISOString() ?? null };
    const updated = await api.updatePrepScreen(screen.id, payload);
    setScreen(updated);
  };

  return (
    <div className="prep-screen">
      <div className="prep-header">
        <h1>{screen.name}</h1>
        {screen.isTakeaway && <span className="chip" style={{ background: 'var(--warning)' }}>Afhalen</span>}
        {live && <span className="chip" style={{ background: 'var(--success)', color: '#fff' }}>● live</span>}
        {pauseState.paused && <span className="chip pause-chip">⏸ Gepauzeerd{pauseState.until ? ` tot ${pauseState.until}` : ''}</span>}
        <div className="spacer" />
        {pauseState.paused
          ? <button className="btn-resume" onClick={doResume}>▶ Hervat bestellingen</button>
          : <button className="btn-pause" onClick={() => setShowPause(true)}>⏸ Pauzeer</button>}
        <a href="/admin" className="chip">← Beheer</a>
        <button onClick={() => refresh()}>↻ Vernieuw</button>
        <label className="muted"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Toon afgerond</label>
      </div>

      {showPause && (
        <div className="sheet-backdrop" onClick={() => setShowPause(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 6 }}>⏸ {screen.name} pauzeren</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
              Klanten kunnen niets bestellen dat op dit scherm bereid wordt, tot de gekozen tijd. De rest van het menu blijft gewoon bestelbaar.
            </p>
            <div className="pause-quick">
              <button onClick={() => doPause(new Date(Date.now() + 30 * 60000))}>30 min</button>
              <button onClick={() => doPause(new Date(Date.now() + 60 * 60000))}>1 uur</button>
              <button onClick={() => doPause(new Date(Date.now() + 120 * 60000))}>2 uur</button>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="muted" style={{ fontSize: 13 }}>tot</label>
              {/* commitOnChange: the Pauzeer button is disabled until a valid
                  time exists, and a disabled button never blurs the input. */}
              <TimeInput value={pauseCustom} onCommit={(v) => setPauseCustom(v || '')} commitOnChange placeholder="13:30" width={92} />
              <button className="primary" disabled={!pauseCustom} onClick={() => { const d = nextAt(pauseCustom); if (d) doPause(d); }}>Pauzeer</button>
            </div>
            <button style={{ width: '100%', marginTop: 14 }} onClick={() => setShowPause(false)}>Annuleren</button>
          </div>
        </div>
      )}

      {(() => {
        // Split tickets into "in prep" and "onderweg" so on-the-road orders don't clutter the prep area.
        const onWayStatuses = new Set(['ON_THE_WAY', 'PICKED_UP']);
        const prepTickets = sortedTickets.filter((o) => !onWayStatuses.has(o.status));
        const onWayTickets = sortedTickets.filter((o) => onWayStatuses.has(o.status));
        return (
          <>
            <h2 className="lane-title">In bereiding / wachtend</h2>
            {prepTickets.length === 0 && !showDone && <div className="card"><p className="muted">Geen open bestellingen. 🎉</p></div>}
            <div className="ticket-grid">
              {prepTickets.map((o) => (
                <Ticket
                  key={o.id}
                  order={o}
                  screen={screen}
                  agents={agents}
                  onMove={(dir) => move(o.id, dir)}
                  onStatus={setStatus}
                  onCycleItem={cycleItem}
                  onAssignAgent={assignAgent}
                  onSendOnWay={sendOnWay}
                  onConfirmDeliver={(oid: number) => setConfirmDeliver(oid)}
                  onConfirmCancel={(oid: number) => setConfirmCancel(oid)}
                  onQuickComplete={quickComplete}
                  onQuickReopen={quickReopen}
                />
              ))}
              {showDone && doneTickets.map((o) => {
                // Reopenable = our part is done but the bigger order is still live, so allow
                // rolling items back. Delivered / fully-done orders stay read-only.
                const reopenable = !['DELIVERED', 'DONE', 'CANCELLED'].includes(o.status);
                return (
                  <Ticket key={o.id} order={o} screen={screen} agents={agents} onMove={() => {}} onStatus={setStatus} onCycleItem={reopenable ? cycleItem : () => {}} onAssignAgent={() => {}} onSendOnWay={() => {}} onConfirmDeliver={() => {}} onConfirmCancel={() => {}} onQuickComplete={quickComplete} onQuickReopen={reopenable ? quickReopen : async () => {}} done reopenable={reopenable} />
                );
              })}
            </div>

            {onWayTickets.length > 0 && (
              <>
                <div className="lane-header" style={{ marginTop: 24 }}>
                  <button className="lane-toggle" onClick={() => setShowOnWay(!showOnWay)}>
                    {showOnWay ? '▼' : '▶'} Onderweg 🛵 ({onWayTickets.length})
                  </button>
                </div>
                {showOnWay && (
                  <div className="ticket-grid onway-lane">
                    {onWayTickets.map((o) => (
                      <Ticket
                        key={o.id}
                        order={o}
                        screen={screen}
                        agents={agents}
                        onMove={(dir) => move(o.id, dir)}
                        onStatus={setStatus}
                        onCycleItem={cycleItem}
                        onAssignAgent={assignAgent}
                        onSendOnWay={sendOnWay}
                        onConfirmDeliver={(oid: number) => setConfirmDeliver(oid)}
                        onConfirmCancel={(oid: number) => setConfirmCancel(oid)}
                        onQuickComplete={quickComplete}
                        onQuickReopen={quickReopen}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* Confirm "Geleverd" modal — prevents accidental delivery confirmation */}
      {confirmDeliver != null && (() => {
        const o = tickets.find((t) => t.id === confirmDeliver) || doneTickets.find((t) => t.id === confirmDeliver);
        return (
          <div className="sheet-backdrop" onClick={() => setConfirmDeliver(null)}>
            <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>✓</div>
              <div style={{ fontWeight: 700, fontSize: 19, textAlign: 'center' }}>Bevestig levering</div>
              <div className="muted" style={{ textAlign: 'center', fontSize: 14, margin: '8px 0 20px' }}>
                {o ? `Bestelling ${o.table?.name || o.tableLabel || '#' + o.id}` : `Bestelling #${confirmDeliver}`} als geleverd markeren?
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button style={{ flex: '0 0 auto' }} onClick={() => setConfirmDeliver(null)}>Annuleren</button>
                <button className="success" style={{ flex: 1 }} onClick={confirmDelivered}>Ja, geleverd</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirm "Annuleer" modal — cancelling now also triggers a refund for paid orders. */}
      {confirmCancel != null && (() => {
        const o = tickets.find((t) => t.id === confirmCancel) || doneTickets.find((t) => t.id === confirmCancel);
        return (
          <div className="sheet-backdrop" onClick={() => setConfirmCancel(null)}>
            <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>✕</div>
              <div style={{ fontWeight: 700, fontSize: 19, textAlign: 'center' }}>Bevestig annuleren</div>
              <div className="muted" style={{ textAlign: 'center', fontSize: 14, margin: '8px 0 20px' }}>
                {o ? `Bestelling ${o.table?.name || o.tableLabel || '#' + o.id}` : `Bestelling #${confirmCancel}`} annuleren?
                {o?.payMethod === 'ONLINE' && <><br />Online betaling wordt automatisch terugbetaald.</>}
              </div>
              <div className="row" style={{ gap: 10 }}>
                <button style={{ flex: '0 0 auto' }} onClick={() => setConfirmCancel(null)}>Terug</button>
                <button className="danger" style={{ flex: 1 }} onClick={confirmCancelled}>Ja, annuleren</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Apply manual positions: known ids in order, then any new orders appended at the end.
function applyPositions(tickets: any[], positions: number[]): any[] {
  if (!positions.length) return tickets;
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const seen = new Set<number>();
  const out: any[] = [];
  for (const id of positions) { const o = byId.get(id); if (o) { out.push(o); seen.add(id); } }
  for (const o of tickets) if (!seen.has(o.id)) out.push(o); // new → appended right
  return out;
}

function isCoordinatorOrder(order: any, screen: any): boolean {
  return order.location?.coordinatorScreenId === screen.id;
}

function Ticket({ order, screen, agents, onMove, onStatus, onCycleItem, onAssignAgent, onSendOnWay, onConfirmDeliver, onConfirmCancel, onQuickComplete, onQuickReopen, done, reopenable }: {
  order: any; screen: any; agents: any[];
  onMove: (dir: -1 | 1) => void;
  onStatus: (orderId: number, status: string) => void;
  onCycleItem: (orderId: number, itemId: number, current: string) => void;
  onAssignAgent: (orderId: number, agentId: number) => void;
  onSendOnWay: (orderId: number, agentId: number | null) => void;
  onConfirmDeliver: (orderId: number) => void;
  onConfirmCancel: (orderId: number) => void;
  onQuickComplete: (orderId: number, itemIds: number[], deliveryMode: string) => void;
  onQuickReopen: (orderId: number, itemIds: number[]) => void;
  done?: boolean;
  reopenable?: boolean;
}) {
  const screenId = screen.id;
  const coordinator = isCoordinatorOrder(order, screen);
  const items = coordinator ? (order.items || []) : (order.items || []).filter((it: any) => it.prepScreenId === screenId);
  // Skip per-item tracking for fast-turnover screens (e.g. Bar) — one tap for
  // the whole order instead of clicking through each item. Coordinator
  // screens keep per-item tracking since they display other screens' progress too.
  const quickMode = !!screen.quickMode && !coordinator;
  const lines = aggregateOrderItems(items);
  const extras = aggregateAppendToEnd(items);
  const when = new Date(order.createdAt);
  const minsAgo = Math.max(0, Math.floor((Date.now() - when.getTime()) / 60000));

  const title = order.table?.name || order.tableLabel || (order.location?.name) || `#${order.id}`;
  const sub = [order.customerName, order.tableLabel && `tafel ${order.tableLabel}`, order.location?.name].filter(Boolean).join(' • ');

  const allItemsDone = items.length > 0 && items.every((it: any) => it.itemStatus === 'DONE');
  const allOursDone = !coordinator && items.length > 0 && items.every((it: any) => it.itemStatus === 'DONE');
  const partOfBiggerOrder = !coordinator && order.location?.coordinatorScreenId && order.location.coordinatorScreenId !== screenId;

  const assignedAgent = order.assignment?.agent;
  const assignedAgentId = order.assignment?.agentId ?? null;

  const statusDot: Record<string, string> = { PENDING: '⚪', PREPARING: '🟡', DONE: '✅' };
  const statusOpacity: Record<string, number> = { PENDING: 1, PREPARING: 1, DONE: 0.5 };

  return (
    <div className={`ticket ${screen.isTakeaway ? 'takeaway' : ''} ${done ? 'done' : ''} ${done && reopenable ? 'reopenable' : ''} ${allItemsDone ? 'ready-handoff' : ''}`}>
      <div className="ticket-head">
        <div>
          <div className="title">{title}</div>
          <div className="time">{sub}{sub ? ' • ' : ''}{when.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })} ({minsAgo} min){order.note ? ` • 📝 ${order.note}` : ''}</div>
        </div>
        {!done && (
          <div className="row">
            <button className="circle small" onClick={() => onMove(-1)}>←</button>
            <button className="circle small" onClick={() => onMove(1)}>→</button>
          </div>
        )}
      </div>

      {/* Badges */}
      {coordinator && <div className="ticket-badge coordinator">🛠️ Coördinator — hele bestelling</div>}
      {partOfBiggerOrder && <div className="ticket-badge bigger">📌 Deel van grotere bestelling #{order.id} — zie {screenNameFor(order.location.coordinatorScreenId, order)}</div>}
      {allItemsDone && <div className="ticket-badge ready">✓ Alles klaar — klaar om mee te geven</div>}
      {done && reopenable && <div className="ticket-badge reopen">✓ Jouw deel is klaar — tik een item om het terug te zetten</div>}

      <div className="ticket-body">
        {!quickMode && <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Klik op een item: wachtend → bezig → klaar → wachtend</div>}
        {lines.map((l) => {
          const matchingItems = items.filter((it: any) => {
            const label = (it.variant?.product?.name || '') + (it.variant?.name ? ` ${it.variant.name}` : '');
            return label === l.label;
          });
          const firstItem = matchingItems[0];
          const itemStatus = firstItem?.itemStatus || 'PENDING';
          const itemScreenId = firstItem?.prepScreenId;
          const isOurs = itemScreenId === screenId;
          const screenName = itemScreenId ? (screenNameFor(itemScreenId, order) || 'andere') : '—';
          const canCycle = isOurs && (!done || reopenable) && !quickMode;
          const deco = itemStatus === 'DONE' ? 'line-through' : 'none';

          return (
            <div key={l.label + (l.note || '')} className="ticket-item" style={{ opacity: statusOpacity[itemStatus] ?? 1 }}>
              <span
                className="qty clickable"
                title={canCycle ? 'Klik om status te wijzigen' : (coordinator ? `${screenName}: ${itemStatus}` : '')}
                onClick={() => canCycle && onCycleItem(order.id, firstItem.id, itemStatus)}
                style={{ cursor: canCycle ? 'pointer' : 'default' }}
              >
                {statusDot[itemStatus]} {l.qty}×
              </span>
              <span
                className="label"
                style={{ textDecoration: deco, cursor: canCycle ? 'pointer' : 'default' }}
                onClick={() => canCycle && onCycleItem(order.id, firstItem.id, itemStatus)}
              >
                {l.label}
              </span>
              <span className="item-meta">
                {coordinator && !isOurs && (
                  <span className={`chip tiny ${itemStatus === 'DONE' ? 'ready' : ''}`}>
                    {screenIcon(screenName)} {screenName}{itemStatus === 'DONE' ? ' ✓' : itemStatus === 'PREPARING' ? ' ⋯' : ' ⋯'}
                  </span>
                )}
                {coordinator && isOurs && (
                  <span className={`chip tiny ours ${itemStatus === 'DONE' ? 'done' : ''}`}>
                    {screen.isTakeaway ? 'Afhalen' : 'Jij'}{itemStatus === 'DONE' ? ' ✓' : itemStatus === 'PREPARING' ? ' ⋯' : ''}
                  </span>
                )}
              </span>
              {!!l.choices.length && <div className="choices">{l.choices.map((c, i) => <div key={i}>↳ {c.menuName}: {c.optionName || 'geen'}</div>)}</div>}
              {l.note && <div className="choices" style={{ color: 'var(--warning)' }}>↳ {l.note}</div>}
            </div>
          );
        })}
        {extras.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
            <strong style={{ fontSize: 12 }}>Extra's:</strong>
            {extras.map((e, i) => <div key={i} className="choices">↳ {e.count}× {e.label}</div>)}
          </div>
        )}
        {items.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Geen items voor dit scherm.</div>}
      </div>

      {!done && (
        <div className="ticket-actions col" style={{ gap: 6 }}>
          {/* Coordinator (afhalen) — bezorger dropdown + delivery handoff */}
          {coordinator && (
            <>
              {/* Bezorger dropdown — only relevant while still prepping, not once on the road */}
              {order.status !== 'ON_THE_WAY' && order.status !== 'PICKED_UP' && (
                <>
                  <div className="row">
                    <select
                      value={assignedAgentId ?? ''}
                      onChange={(e) => e.target.value && onAssignAgent(order.id, Number(e.target.value))}
                      style={{ flex: 1 }}
                    >
                      <option value="">{assignedAgentId ? '↻ Andere bezorger…' : 'Bezorger toewijzen…'}</option>
                      {agents.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {assignedAgent && <a href={`/bezorger/${assignedAgent.code}`} target="_blank" rel="noreferrer" className="chip">{assignedAgent.code} ↗</a>}
                  </div>
                  {assignedAgent && <div className="muted" style={{ fontSize: 12 }}>Bezorger: <strong>{assignedAgent.name}</strong></div>}
                </>
              )}
              {(order.status === 'ON_THE_WAY' || order.status === 'PICKED_UP') && assignedAgent && (
                <div className="muted" style={{ fontSize: 12 }}>🛵 Onderweg met <strong>{assignedAgent.name}</strong> — klant volgt live</div>
              )}
              <div className="row">
                {/* While prepping: "Bezig" tells customer we're working on it. */}
                {(order.status === 'NEW') && <button className="btn-busy" onClick={() => onStatus(order.id, 'BUSY')}>Bezig</button>}
                {/* "🛵 Onderweg" = bezorger left with the order. Assigns the chosen bezorger + marks pickup. */}
                {order.status !== 'ON_THE_WAY' && order.status !== 'PICKED_UP' && (
                  <button className="primary" onClick={() => onSendOnWay(order.id, assignedAgentId)} title={assignedAgentId ? `Bezorger ${assignedAgent?.name} gaat op pad` : 'Stel eerst een bezorger in'}>
                    🛵 Onderweg
                  </button>
                )}
                {/* Once on the road, the only remaining action is "delivered". */}
                <button className="success" onClick={() => onConfirmDeliver(order.id)}>✓ Geleverd</button>
              </div>
            </>
          )}

          {/* Non-coordinator, quick mode (e.g. Bar) — one tap for the whole order. */}
          {!coordinator && quickMode && (
            <button className="success" onClick={() => onQuickComplete(order.id, items.map((it: any) => it.id), order.deliveryMode)}>
              ✓ Bestelling klaar{order.deliveryMode !== 'EAT_IN' ? ' voor afhalen' : ''}
            </button>
          )}

          {/* Non-coordinator, per-item tracking — when all items DONE, signal ready */}
          {!coordinator && !quickMode && (
            <>
              {!allOursDone && <div className="muted" style={{ fontSize: 12 }}>Klik items aan om ze klaar te melden.</div>}
              {allOursDone && (
                <button className="success" onClick={() => onStatus(order.id, order.deliveryMode === 'EAT_IN' ? 'DONE' : 'READY')}>
                  ✓ Bestelling klaar{order.deliveryMode !== 'EAT_IN' ? ' voor afhalen' : ''}
                </button>
              )}
            </>
          )}

          <button className="danger" onClick={() => onConfirmCancel(order.id)}>✕ Annuleer</button>
        </div>
      )}

      {/* Quick-mode reopen: a single button instead of per-item click-to-cycle. */}
      {done && reopenable && quickMode && (
        <div className="ticket-actions col" style={{ gap: 6 }}>
          <button onClick={() => onQuickReopen(order.id, items.map((it: any) => it.id))}>↺ Heropenen</button>
        </div>
      )}
    </div>
  );
}

function screenNameFor(screenId: number, order: any): string {
  for (const it of (order.items || [])) {
    if (it.prepScreen?.id === screenId) return it.prepScreen.name;
  }
  return 'scherm';
}

function screenIcon(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('keu')) return '🍳';
  if (n.includes('bar')) return '🍸';
  if (n.includes('afhal')) return '🥡';
  if (n.includes('cocktail')) return '🍹';
  return '🍽️';
}
