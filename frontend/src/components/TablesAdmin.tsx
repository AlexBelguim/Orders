import { useEffect, useState } from 'react';
import * as api from '../lib/api';

export default function TablesAdmin({ locations, screens, onChange }: { locations: any[]; screens: any[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [tables, setTables] = useState<any[] | null>(null);

  const loadTables = () => { api.getTables().then(setTables); };
  useEffect(() => { loadTables(); }, []);

  const refreshAll = async () => { await onChange(); loadTables(); };

  const add = async () => {
    if (!name.trim()) return;
    await api.createTable({ name: name.trim(), code: code.trim().toUpperCase() || undefined, locationId: locationId || undefined });
    setName(''); setCode(''); refreshAll();
  };

  return (
    <div className="col">
      <div className="section-card">
        <h2>Tafel toevoegen</h2>
        <div className="row">
          <input placeholder="Naam (bv. Tafel 1)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Code (auto)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 120 }} />
          <select value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Geen locatie</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="primary" onClick={add}>Toevoegen</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Voor restaurant-locaties: één QR per tafel (3D print).</p>
      </div>

      {!tables && <div className="muted">Laden…</div>}
      {tables && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {tables.map((t) => (
            <TableCard key={t.id} t={t} locations={locations} screens={screens} onChange={refreshAll} />
          ))}
          {tables.length === 0 && <div className="card muted">Nog geen tafels.</div>}
        </div>
      )}
    </div>
  );
}

function TableCard({ t, locations, screens, onChange }: { t: any; locations: any[]; screens: any[]; onChange: () => void }) {
  const [showRouting, setShowRouting] = useState(false);
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | ''>('');

  const overrides = t.routeOverrides || [];

  return (
    <div className="section-card" style={{ marginBottom: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong>{t.name}</strong> <span className="muted" style={{ fontSize: 13 }}>({t.code})</span>
        </div>
        <a href={`${import.meta.env.VITE_API_URL || ''}/api/qr/table/${t.code}.png`} target="_blank" rel="noreferrer" className="chip">QR</a>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <label>Locatie:</label>
        <select defaultValue={t.locationId ?? ''} onChange={async (e) => { await api.updateTable(t.id, { locationId: e.target.value || null }); onChange(); }}>
          <option value="">Geen</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <button className="block" style={{ marginTop: 8 }} onClick={() => setShowRouting(!showRouting)}>
        {showRouting ? '▲' : '▼'} Bereiding doorsturen ({overrides.length})
      </button>
      {showRouting && (
        <div style={{ marginTop: 8, padding: 8, background: 'var(--surface-alt)', borderRadius: 8 }}>
          <p className="muted" style={{ fontSize: 12 }}>Stuur items die normaal naar scherm X gaan, door naar scherm Y (bv. Bar → Bar 2).</p>
          {overrides.map((ro: any) => (
            <div key={ro.id} className="row" style={{ fontSize: 13, marginBottom: 2 }}>
              <span style={{ flex: 1 }}>{ro.fromScreen?.name} → {ro.toScreen?.name}</span>
              <button className="danger" onClick={async () => { await api.deleteRouteOverride(t.id, ro.fromScreenId); onChange(); }}>✕</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
            <select value={fromId} onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">van…</option>
              {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span>→</span>
            <select value={toId} onChange={(e) => setToId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">naar…</option>
              {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="primary" disabled={!fromId || !toId} onClick={async () => { await api.addRouteOverride(t.id, Number(fromId), Number(toId)); setFromId(''); setToId(''); onChange(); }}>+</button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="danger" onClick={async () => { if (confirm('Tafel verwijderen?')) { await api.hardDeleteTable(t.id); onChange(); } }}>Verwijderen</button>
      </div>
    </div>
  );
}
