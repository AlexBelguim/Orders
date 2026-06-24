import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { euro } from '../lib/format';
import { todayISO } from '../lib/format';

export default function StatsPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [mode, setMode] = useState<'DAY' | 'RANGE'>('DAY');
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getLocations().then(setLocations); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (locationId) params.locationId = locationId;
      if (mode === 'DAY') params.date = date;
      else { params.from = from; params.to = to; }
      const r = await api.getStats(params);
      setData(r);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [locationId, mode, date, from, to]);

  const isDelivery = locations.find((l) => l.id === locationId)?.kind === 'DELIVERY';

  return (
    <div className="admin">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>📊 Statistieken</h1>
        <a href="/admin" className="chip">← Beheer</a>
      </div>

      <div className="section-card">
        <div className="row">
          <label>Locatie:</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Alle</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.kind === 'EAT_IN' ? 'restaurant' : 'levering'})</option>)}
          </select>
          <label><input type="radio" checked={mode === 'DAY'} onChange={() => setMode('DAY')} /> Per dag</label>
          <label><input type="radio" checked={mode === 'RANGE'} onChange={() => setMode('RANGE')} /> Periode</label>
          {mode === 'DAY' ? (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          ) : (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span>tot</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {loading && <div className="card muted">Laden…</div>}
      {!loading && data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: 16 }}>
            <div className="card"><div className="muted" style={{ fontSize: 13 }}>Bestellingen</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.orderCount}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 13 }}>Omzet</div><div style={{ fontSize: 24, fontWeight: 700 }}>{euro(data.grandTotalCents)}</div></div>
            {isDelivery && <div className="card"><div className="muted" style={{ fontSize: 13 }}>Commissie locatie</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{euro(data.grandCommissionCents)}</div></div>}
            {isDelivery && <div className="card"><div className="muted" style={{ fontSize: 13 }}>Netto (jouw deel)</div><div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{euro(data.netCents)}</div></div>}
          </div>

          <div className="section-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Categorie</th>
                  <th style={{ textAlign: 'right' }}>Aantal</th>
                  <th style={{ textAlign: 'right' }}>Omzet</th>
                  {isDelivery && <th style={{ textAlign: 'right' }}>Commissie</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: any, i: number) => (
                  <tr key={i}>
                    <td>{it.product}</td>
                    <td className="muted">{it.category || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{it.qty}</td>
                    <td style={{ textAlign: 'right' }}>{euro(it.totalCents)}</td>
                    {isDelivery && <td style={{ textAlign: 'right' }}>{euro(it.commissionCents)}</td>}
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={isDelivery ? 5 : 4} className="muted">Geen verkopen in deze periode.</td></tr>}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={3}>Totaal</td>
                  <td style={{ textAlign: 'right' }}>{euro(data.grandTotalCents)}</td>
                  {isDelivery && <td style={{ textAlign: 'right' }}>{euro(data.grandCommissionCents)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
