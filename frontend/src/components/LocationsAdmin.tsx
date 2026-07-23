import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { euro, euroToCents } from '../lib/format';
import TimeInput from './TimeInput';

export default function LocationsAdmin({ profiles, screens, locations, onChange }: { profiles: any[]; screens: any[]; locations: any[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'DELIVERY' | 'EAT_IN'>('DELIVERY');
  const [expanded, setExpanded] = useState<number | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    await api.createLocation({ name: name.trim(), kind });
    setName(''); onChange();
  };

  return (
    <div className="col">
      <div className="section-card">
        <h2>Locatie toevoegen</h2>
        <div className="row">
          <input placeholder="Naam (bv. Black Pearl)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="DELIVERY">Levering (festival terras)</option>
            <option value="EAT_IN">Eigen restaurant (tafels)</option>
          </select>
          <button className="primary" onClick={add}>Toevoegen</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {kind === 'DELIVERY'
            ? 'Eén QR-code per locatie; klant typt zijn tafelnummer. Commissie, e-mailbevestiging en online betaling zijn actief.'
            : 'Eén QR-code per tafel (3D print); anoniem bestellen, betalen aan de balie.'}
        </p>
      </div>

      {locations.length === 0 && <div className="card muted">Nog geen locaties.</div>}

      {locations.map((loc) => (
        <div key={loc.id} className="section-card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <strong>{loc.name}</strong>
              <span className="chip">{loc.kind === 'EAT_IN' ? 'Restaurant' : 'Levering'}</span>
              <span className="muted" style={{ fontSize: 13 }}>code: {loc.code}</span>
            </div>
            <div className="row">
              <a href={`${import.meta.env.VITE_API_URL || ''}/api/qr/location/${loc.code}.png`} target="_blank" rel="noreferrer" className="chip">QR</a>
              <button onClick={() => setExpanded(expanded === loc.id ? null : loc.id)}>{expanded === loc.id ? '▲ Sluiten' : '▼ Details'}</button>
            </div>
          </div>

          {expanded === loc.id && (
            <LocationDetail loc={loc} profiles={profiles} screens={screens} onChange={onChange} />
          )}
        </div>
      ))}
    </div>
  );
}

function LocationDetail({ loc, profiles, screens, onChange }: { loc: any; profiles: any[]; screens: any[]; onChange: () => void }) {
  const isDelivery = loc.kind === 'DELIVERY';
  const allowed: number[] = (loc.allowedProfiles || []).map((ap: any) => ap.profileId || ap.profile?.id).filter(Boolean);

  const patch = async (data: any) => { await api.updateLocation(loc.id, data); onChange(); };
  const toggleProfile = async (pid: number) => {
    const next = allowed.includes(pid) ? allowed.filter((x) => x !== pid) : [...allowed, pid];
    await api.setLocationAllowedProfiles(loc.id, next); onChange();
  };

  return (
    <div className="col" style={{ marginTop: 12 }}>
      <div className="row">
        <label>Naam</label>
        <input defaultValue={loc.name} onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value })} style={{ flex: 1 }} />
      </div>

      <div className="row">
        <label>Soort</label>
        <select defaultValue={loc.kind} onChange={(e) => patch({ kind: e.target.value })}>
          <option value="DELIVERY">Levering</option>
          <option value="EAT_IN">Restaurant</option>
        </select>
      </div>

      <div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Zichtbare menu's (profielen):</div>
        <div className="chip-group">
          {profiles.map((p) => (
            <button key={p.id} className={`chip ${allowed.includes(p.id) ? 'primary' : ''}`} onClick={() => toggleProfile(p.id)}>
              {allowed.includes(p.id) ? '✓ ' : ''}{p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <label>Standaard scherm (levering/afhalen)</label>
        <select defaultValue={loc.prepScreenId ?? ''} onChange={(e) => patch({ prepScreenId: e.target.value || null })}>
          <option value="">—</option>
          {screens.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isTakeaway ? ' (afhalen)' : ''}</option>)}
        </select>
      </div>

      <div className="row">
        <label>Coördinator-scherm</label>
        <select defaultValue={loc.coordinatorScreenId ?? ''} onChange={(e) => patch({ coordinatorScreenId: e.target.value || null })}>
          <option value="">— geen —</option>
          {screens.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isTakeaway ? ' (afhalen)' : ''}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>Dit scherm toont de hele bestelling met live-status van keuken/bar.</span>
      </div>

      {isDelivery && (
        <>
          <div className="row">
            <label>Leveringsbericht</label>
            <input defaultValue={loc.deliveryNote || ''} placeholder="bv. Geleverd binnen ~20 min." onBlur={(e) => patch({ deliveryNote: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="row">
            <label>ETA (min)</label>
            <input type="number" defaultValue={loc.deliveryEtaMin ?? ''} onBlur={(e) => patch({ deliveryEtaMin: e.target.value ? Number(e.target.value) : null })} style={{ width: 90 }} />
            <label>Min. bestelbedrag (€)</label>
            <input type="number" defaultValue={loc.minOrderCents ? (loc.minOrderCents / 100) : ''} onBlur={(e) => { const c = euroToCents(e.target.value); patch({ minOrderCents: Number.isNaN(c) ? null : c }); }} style={{ width: 90 }} />
          </div>
          <div className="row">
            <label>Open van</label>
            <TimeInput value={loc.openFrom} onCommit={(v) => patch({ openFrom: v })} placeholder="11:00" />
            <label>tot</label>
            {/* stored legacy "24:00" shows as 00:00 — same meaning (tot middernacht) */}
            <TimeInput value={loc.openUntil === '24:00' ? '00:00' : loc.openUntil} onCommit={(v) => patch({ openUntil: v })} placeholder="00:00" />
            {(loc.openFrom || loc.openUntil) && (
              <button onClick={() => patch({ openFrom: null, openUntil: null })}>✕ Altijd open</button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>24-uurs. Buiten deze uren kan er niet besteld worden. 00:00 als einde = tot middernacht. Leeg = altijd open.</span>
          </div>

          <CommissionEditor loc={loc} onChange={onChange} />
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="danger" onClick={async () => { if (confirm(`Locatie "${loc.name}" verwijderen?`)) { await api.deleteLocation(loc.id); onChange(); } }}>Locatie verwijderen</button>
      </div>
    </div>
  );
}

function CommissionEditor({ loc, onChange }: { loc: any; onChange: () => void }) {
  const [tree, setTree] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>(loc.commissionOverrides || []);

  useEffect(() => {
    // Build a flat list of categories + products for selection.
    Promise.all((loc.allowedProfiles || []).map((ap: any) => api.getProductTree(ap.profileId || ap.profile?.id)))
      .then((trees) => {
        const seen = new Set<number>();
        const cats: any[] = [];
        trees.forEach((t) => (t?.categories || []).forEach((c: any) => { if (!seen.has(c.id)) { seen.add(c.id); cats.push(c); } }));
        setTree(cats);
      });
  }, [loc]);

  const setCommission = async (scope: 'CATEGORY' | 'PRODUCT', targetId: number, cents: number) => {
    if (cents <= 0) { await api.deleteCommission(loc.id, scope, targetId); }
    else { await api.putCommission(loc.id, scope, targetId, cents); }
    onChange();
  };

  return (
    <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface-alt)' }}>
      <strong style={{ fontSize: 13 }}>Commissie per item (vast €)</strong>
      <p className="muted" style={{ fontSize: 12 }}>Welk deel gaat naar deze locatie? Leeg = €0. Geldt per product, anders per categorie.</p>
      {tree.map((cat: any) => {
        const catOv = overrides.find((o: any) => o.scope === 'CATEGORY' && o.targetId === cat.id);
        return (
          <div key={cat.id} style={{ marginBottom: 8 }}>
            <div className="row" style={{ fontSize: 13, fontWeight: 600 }}>
              <span style={{ flex: 1 }}>{cat.name}</span>
              <label className="muted">cat:</label>
              <input type="number" step="0.01" defaultValue={catOv ? (catOv.fixedCents / 100) : ''} style={{ width: 70 }}
                onBlur={async (e) => { const c = euroToCents(e.target.value); await setCommission('CATEGORY', cat.id, Number.isNaN(c) ? 0 : c); }} />
            </div>
            <div style={{ paddingLeft: 12 }}>
              {(cat.products || []).map((p: any) => {
                const prodOv = overrides.find((o: any) => o.scope === 'PRODUCT' && o.targetId === p.id);
                return (
                  <div key={p.id} className="row" style={{ fontSize: 13, marginBottom: 2 }}>
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <input type="number" step="0.01" defaultValue={prodOv ? (prodOv.fixedCents / 100) : ''} style={{ width: 70 }}
                      onBlur={async (e) => { const c = euroToCents(e.target.value); await setCommission('PRODUCT', p.id, Number.isNaN(c) ? 0 : c); }} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {tree.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Kies eerst zichtbare menu's.</div>}
    </div>
  );
}
