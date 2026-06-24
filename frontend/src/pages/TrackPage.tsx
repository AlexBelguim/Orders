import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import * as api from '../lib/api';
import { euro } from '../lib/format';
import { createTrackMap, type MapHandle } from '../lib/map';

const API = import.meta.env.VITE_API_URL || '';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NEW: { label: 'Ontvangen', color: '#1976D2' },
  IN_PREP: { label: 'In bereiding', color: '#f59e0b' },
  BUSY: { label: 'Bezig met maken', color: '#f59e0b' },
  READY: { label: 'Klaar', color: '#2e7d32' },
  ASSIGNED: { label: 'Bezorger toegewezen', color: '#9c27b0' },
  PICKED_UP: { label: 'Opgehaald', color: '#9c27b0' },
  ON_THE_WAY: { label: 'Onderweg', color: '#1976D2' },
  DELIVERED: { label: 'Geleverd', color: '#2e7d32' },
  DONE: { label: 'Afgerond', color: '#2e7d32' },
  CANCELLED: { label: 'Geannuleerd', color: '#c62828' },
};

export default function TrackPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const wantsCancel = params.get('action') === 'cancel';
  const wantsShare = params.get('share') === '1';
  const [order, setOrder] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [cancelMsg, setCancelMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'sharing' | 'denied' | 'unsupported'>('idle');
  const [agentPos, setAgentPos] = useState<{ lat: number; lon: number } | null>(null);
  const [customerPos, setCustomerPos] = useState<{ lat: number; lon: number } | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false); // have we fetched existing positions yet?
  const [stopped, setStopped] = useState(false); // user tapped "Stop met delen"

  const gpsWatch = useRef<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapHandle = useRef<MapHandle | null>(null);

  const load = useCallback(async () => {
    try { setOrder(await api.getOrderByToken(token!)); } catch (e: any) { setErr(e?.message || 'Niet gevonden'); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Live socket: re-fetch on any order/dispatch change.
  useEffect(() => {
    const sock = io(API, { transports: ['websocket', 'polling'] });
    sock.on('orderUpdated', () => load());
    sock.on('dispatchUpdated', () => load());
    sock.on('positionUpdate', (p: any) => {
      if (p.source === 'AGENT') setAgentPos({ lat: p.lat, lon: p.lon });
      else if (p.source === 'CUSTOMER') setCustomerPos({ lat: p.lat, lon: p.lon });
    });
    return () => { sock.disconnect(); };
  }, [load]);

  // Share customer location so the agent can find them at the plaza.
  const startShare = useCallback(() => {
    if (gpsWatch.current != null) return; // already watching
    if (!('geolocation' in navigator)) { setGpsStatus('unsupported'); return; }
    setGpsStatus('sharing');
    gpsWatch.current = navigator.geolocation.watchPosition(
      async (pos) => {
        try { await api.postCustomerPosition(token!, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); setCustomerPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }); } catch {}
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }, [token]);
  const stopShare = useCallback(() => {
    if (gpsWatch.current != null) { navigator.geolocation.clearWatch(gpsWatch.current); gpsWatch.current = null; }
    setStopped(true);
    setGpsStatus('idle');
  }, []);
  useEffect(() => () => { if (gpsWatch.current != null) navigator.geolocation.clearWatch(gpsWatch.current); }, []);

  // Bootstrap positions when order loads.
  useEffect(() => {
    if (!order) return;
    api.getOrderPositions(order.id).then((r: any) => {
      if (r.latestAgent) setAgentPos({ lat: r.latestAgent.lat, lon: r.latestAgent.lon });
      if (r.latestCustomer) setCustomerPos({ lat: r.latestCustomer.lat, lon: r.latestCustomer.lon });
      setBootstrapped(true);
    });
  }, [order?.id]);

  // AUTO-START GPS sharing on mount if:
  //  - customer came from the "OK" button (?share=1), OR
  //  - order is still active (not delivered/cancelled) and we have no customer position yet.
  // This avoids the redundant "Deel mijn locatie" button after the modal.
  useEffect(() => {
    if (!bootstrapped || !order) return;
    const terminal = ['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status);
    if (terminal) return;
    if (!stopped && (wantsShare || !customerPos)) {
      startShare();
    }
  }, [bootstrapped, order, wantsShare, customerPos, startShare, stopped]);

  // Keep map in sync with positions.
  useEffect(() => {
    if (!mapContainerRef.current || (!agentPos && !customerPos)) return;
    let cancelled = false;
    (async () => {
      if (!mapHandle.current) {
        try { mapHandle.current = await createTrackMap(mapContainerRef.current!); }
        catch { return; }
      }
      if (cancelled || !mapHandle.current) return;
      const m = mapHandle.current;
      if (customerPos) m.setCustomer(customerPos.lat, customerPos.lon);
      if (agentPos) m.setAgent(agentPos.lat, agentPos.lon);
      m.fit();
    })();
    return () => { cancelled = true; };
  }, [agentPos, customerPos]);

  useEffect(() => () => { mapHandle.current?.destroy(); mapHandle.current = null; }, []);

  if (err) return <div className="track"><div className="card"><h1>Bestelling niet gevonden</h1><p className="muted">{err}</p></div></div>;
  if (!order) return <div className="track"><div className="card"><p className="muted">Laden…</p></div></div>;

  const st = STATUS_LABELS[order.status] || STATUS_LABELS.NEW;
  const elapsed = Date.now() - new Date(order.createdAt).getTime();
  const canCancel = order.status !== 'CANCELLED' && elapsed <= 2 * 60 * 1000 && !['DELIVERED', 'DONE'].includes(order.status);
  const hasAssignment = !!(order.assignment || order.assignedAgentId);
  const showMap = hasAssignment && (!!agentPos || !!customerPos);

  const lines = (order.items || []).map((it: any) => ({
    label: (it.variant?.product?.name || '') + (it.variant?.name ? ` ${it.variant.name}` : ''),
    qty: it.qty,
    choices: (it.choices || []).filter((c: any) => !c.appendToEnd).map((c: any) => `${c.menuName}: ${c.optionName || 'geen'}`),
  }));
  const total = (order.items || []).reduce((s: number, it: any) => s + (it.unitPriceCents || 0) * it.qty, 0);

  const doCancel = async () => {
    setBusy(true); setCancelMsg('');
    try {
      await api.cancelOrderByToken(token!);
      setCancelMsg('Je bestelling is geannuleerd.');
      await load();
    } catch (e: any) { setCancelMsg(e?.message.includes('expired') ? 'Annuleren is niet meer mogelijk (na 2 minuten). Bel ons aub.' : (e?.message || 'Annuleren mislukt')); }
    finally { setBusy(false); }
  };

  const S = order.status;
  const prepared = ['READY', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'DONE'].includes(S);
  const onWay = ['PICKED_UP', 'ON_THE_WAY'].includes(S);
  const delivered = ['DELIVERED', 'DONE'].includes(S);
  const cancelled = S === 'CANCELLED';
  const agentName = order.assignment?.agent?.name;
  const headerTitle = cancelled ? 'Geannuleerd'
    : delivered ? 'Geleverd'
    : onWay ? 'Onderweg naar je toe'
    : prepared ? 'Je bestelling is klaar'
    : 'Bestelling ontvangen';

  return (
    <div className="track">
      <div className="track-header">
        <div className="track-header-sub">BESTELLING #{order.id}</div>
        <div className="track-header-title">{headerTitle}</div>
      </div>

      {cancelled ? (
        <div className="card"><div className="error" style={{ margin: 0 }}>Deze bestelling is geannuleerd.</div></div>
      ) : (
        <>
          {/* Status timeline */}
          <div className="card track-steps">
            <div className="track-step done"><span className="ts-dot">✓</span><span>Bestelling ontvangen</span></div>
            <div className={`track-step ${prepared ? 'done' : 'active'}`}><span className="ts-dot">{prepared ? '✓' : '👨‍🍳'}</span><span>Klaargemaakt</span></div>
            {delivered ? (
              <div className="track-step done"><span className="ts-dot">✓</span><span>Geleverd</span></div>
            ) : (
              <div className={`track-step ${onWay ? 'current' : 'pending'}`}><span className="ts-dot">🛵</span><span>{onWay ? `Onderweg — ${agentName || 'bezorger'} komt eraan` : 'Onderweg'}</span></div>
            )}
          </div>

          {/* Live map */}
          {showMap && (
            <div className="track-map-card">
              <div ref={mapContainerRef} className="track-map" />
              {gpsStatus === 'sharing' && (
                <div className="track-map-badge"><span className="live-dot" /> Je locatie wordt gedeeld</div>
              )}
            </div>
          )}

          {/* Share controls */}
          {!delivered && gpsStatus === 'sharing' && (
            <button className="track-stop" onClick={stopShare}>Stop met delen</button>
          )}
          {!delivered && stopped && gpsStatus === 'idle' && (
            <button className="track-stop" onClick={() => { setStopped(false); startShare(); }}>📍 Locatie weer delen</button>
          )}
          {!delivered && (gpsStatus === 'denied' || gpsStatus === 'unsupported') && (
            <button className="block" style={{ marginTop: 10 }} onClick={startShare} disabled={gpsStatus === 'unsupported'}>
              {gpsStatus === 'denied' ? '📍 Locatie geweigerd — probeer opnieuw' : 'Locatie niet ondersteund op dit apparaat'}
            </button>
          )}

          {/* Order summary */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 8, fontSize: 13 }}>{order.location?.name}{order.tableLabel ? ` • tafel ${order.tableLabel}` : ''} · {new Date(order.createdAt).toLocaleString('nl-BE')}</div>
            <table className="data">
              <tbody>
                {lines.map((l: any, i: number) => (
                  <tr key={i}><td>{l.qty}×</td><td>{l.label}{l.choices.length ? <div className="muted" style={{ fontSize: 12 }}>{l.choices.join(', ')}</div> : null}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, fontWeight: 700 }}>
              <span>Totaal</span><span>{euro(total)}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Betaling: {order.payMethod === 'ONLINE' ? 'online betaald' : order.payMethod === 'NONE' ? '—' : 'bij levering'}
            </div>
            {order.note && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Opmerking: {order.note}</div>}
          </div>

          {/* Cancel (within 2 min) */}
          {(wantsCancel || canCancel) && (
            <div className="card" style={{ marginTop: 12 }}>
              <strong>Bestelling annuleren?</strong>
              <p className="muted" style={{ fontSize: 13 }}>Alleen mogelijk binnen 2 minuten na bestellen.</p>
              {cancelMsg && <div className={cancelMsg.includes('niet meer') ? 'error' : ''} style={{ marginTop: 8 }}>{cancelMsg}</div>}
              <button className="danger block" style={{ marginTop: 8 }} disabled={busy} onClick={doCancel}>Annuleer mijn bestelling</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
