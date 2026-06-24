import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as api from '../lib/api';
import { euro } from '../lib/format';
import { aggregateOrderItems } from '../lib/menu';
import { osmEmbedUrl } from '../lib/map';

export default function AgentPage() {
  const { code } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [agent, setAgent] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'sharing' | 'denied' | 'unsupported'>('idle');
  const watchId = useRef<number | null>(null);

  const load = async () => {
    try {
      const r = await api.getAgentActiveOrders(code!);
      setItems(r.items || []);
      if (r.items?.[0]?.assignment?.agent) setAgent(r.items[0].assignment.agent);
    } catch (e: any) { setErr(e?.message || 'Onbekend'); }
  };
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [code]);

  const startGps = () => {
    if (!('geolocation' in navigator)) { setGpsStatus('unsupported'); return; }
    setGpsStatus('sharing');
    let lastSent = 0;
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSent < 4000) return;
        lastSent = now;
        try {
          await api.postAgentPosition(code!, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading);
        } catch {}
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  };

  const stopGps = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setGpsStatus('idle');
  };

  useEffect(() => () => stopGps(), []);

  if (err) return <div className="agent"><div className="card"><h1>Fout</h1><p className="muted">{err}</p></div></div>;

  return (
    <div className="agent">
      <div className="prep-header">
        <h1>🛵 Bezorger</h1>
        {agent && <span className="chip">{agent.name}</span>}
        {items.length > 0 && <span className="chip primary">{items.length} levering{items.length > 1 ? 'en' : ''}</span>}
        <div className="spacer" />
      </div>

      {/* GPS control */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <strong>Mijn locatie</strong>
          <div className="spacer" />
          {gpsStatus === 'sharing' && <span className="status-badge" style={{ background: 'var(--success)', color: '#fff' }}>● Delen</span>}
          {gpsStatus === 'denied' && <span className="status-badge" style={{ background: 'var(--danger)', color: '#fff' }}>Geweigerd</span>}
          {gpsStatus === 'unsupported' && <span className="muted">Niet ondersteund</span>}
          {gpsStatus === 'idle' && <span className="muted">Uit</span>}
        </div>
        {gpsStatus !== 'sharing'
          ? <button className="primary block" style={{ marginTop: 8 }} onClick={startGps}>📍 Start locatie-deling</button>
          : <button className="block" style={{ marginTop: 8 }} onClick={stopGps}>Stop locatie-deling</button>}
        {gpsStatus === 'denied' && <p className="error" style={{ marginTop: 6 }}>Sta locatie-deling toe in je browser om gepositioneerd te worden.</p>}
      </div>

      {items.length === 0 && <div className="card"><p className="muted">Geen actieve leveringen. Nieuwe opdrachten verschijnen hier automatisch.</p></div>}

      {items.map(({ assignment, customerPing }) => {
        const order = assignment?.order;
        if (!order) return null;
        return (
          <div key={order.id} className="ticket" style={{ marginBottom: 12 }}>
            <div className="ticket-head">
              <div>
                <div className="title">#{order.id} — {order.customerName}</div>
                <div className="time">{order.location?.name}{order.tableLabel ? ` • tafel ${order.tableLabel}` : ''}</div>
              </div>
              <span className="status-badge" style={{ background: assignment.status === 'PICKED_UP' ? 'var(--warning)' : 'var(--primary)', color: '#fff', fontSize: 11 }}>
                {assignment.status === 'PICKED_UP' ? '🛵 Onderweg' : 'Klaar'}
              </span>
            </div>
            <div className="ticket-body">
              {order.customerPhone && <a className="call-btn" href={`tel:${order.customerPhone}`}>📞 Bel klant</a>}
              {customerPing ? (
                <>
                  <div className="agent-map">
                    <iframe title="Klant locatie" src={osmEmbedUrl(customerPing.lat, customerPing.lon)} loading="lazy" />
                    <div className="agent-map-pin">📍</div>
                    <div className="agent-map-badge">Klant · ±{Math.round(customerPing.accuracy || 0)}m</div>
                  </div>
                  <a className="maps-link" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${customerPing.lat},${customerPing.lon}`}>↗ Open in Maps voor navigatie</a>
                </>
              ) : (
                <div className="muted" style={{ fontSize: 12, margin: '8px 0' }}>Klant deelt geen locatie — bel voor de exacte plaats.</div>
              )}

              <div style={{ marginTop: 10 }}>
                {(aggregateOrderItems(order.items || [])).map((l, i) => (
                  <div key={i} className="ticket-item">
                    <span className="qty">{l.qty}×</span>
                    <span className="label">{l.label}</span>
                    <span></span>
                    {!!l.choices.length && <div className="choices">{l.choices.map((c, j) => <div key={j}>↳ {c.menuName}: {c.optionName || 'geen'}</div>)}</div>}
                    {l.note && <div className="choices" style={{ color: 'var(--warning)' }}>↳ {l.note}</div>}
                  </div>
                ))}
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontWeight: 600 }}>
                  <span>Totaal</span><span>{euro((order.items || []).reduce((s: number, it: any) => s + (it.unitPriceCents || 0) * it.qty, 0))}</span>
                </div>
                {order.payMethod && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{order.payMethod === 'ONLINE' ? 'Online betaald' : 'Betalen bij levering'}</div>}
                {order.note && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>📝 {order.note}</div>}
              </div>
            </div>
            <div className="ticket-actions col">
              {assignment.status !== 'PICKED_UP' && <button className="primary" onClick={async () => { await api.markPickup(order.id); load(); }}>Opgehaald → onderweg</button>}
              <button className="success" onClick={async () => { await api.setOrderStatus(order.id, 'DELIVERED'); load(); }}>✓ Geleverd</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
