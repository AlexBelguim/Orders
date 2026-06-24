import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { euro, euroToCents } from '../lib/format';

export default function ChoicesAdmin() {
  const [menus, setMenus] = useState<any[]>([]);
  const [name, setName] = useState('');
  const load = () => api.getChoiceMenus().then(setMenus);
  useEffect(() => { load(); }, []);

  const addMenu = async () => { if (!name.trim()) return; await api.createChoiceMenu(name.trim()); setName(''); load(); };

  return (
    <div className="col">
      <div className="section-card">
        <h2>Keuzemenu's</h2>
        <p className="muted" style={{ fontSize: 13 }}>Herbruikbare groepen (bv. "Saus", "Extra's"). Koppel ze aan producten op het Producten-tabblad.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="Naam (bv. Saus)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={addMenu}>Toevoegen</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {menus.map((m) => (
          <MenuCard key={m.id} menu={m} onChange={load} />
        ))}
        {menus.length === 0 && <div className="card muted">Nog geen keuzemenu's.</div>}
      </div>
    </div>
  );
}

function MenuCard({ menu, onChange }: { menu: any; onChange: () => void }) {
  const [optName, setOptName] = useState('');
  const [optPrice, setOptPrice] = useState('');

  const opts = [...(menu.options || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  const addOption = async () => {
    if (!optName.trim()) return;
    const cents = euroToCents(optPrice || '0');
    await api.addChoiceOption(menu.id, optName.trim(), Number.isNaN(cents) ? 0 : cents);
    setOptName(''); setOptPrice(''); onChange();
  };

  return (
    <div className="section-card" style={{ marginBottom: 0 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <input defaultValue={menu.name} onBlur={async (e) => { if (e.target.value.trim() && e.target.value !== menu.name) { await api.updateChoiceMenu(menu.id, { name: e.target.value }); onChange(); } }} style={{ flex: 1, fontWeight: 600 }} />
        <label title="Eén keuze verplicht"><input type="checkbox" checked={!!menu.requireOne} onChange={async (e) => { await api.updateChoiceMenu(menu.id, { requireOne: e.target.checked }); onChange(); }} /> 1 verplicht</label>
        <label title="Meerdere opties tegelijk kiesbaar"><input type="checkbox" checked={!!menu.allowMultiple} onChange={async (e) => { await api.updateChoiceMenu(menu.id, { allowMultiple: e.target.checked }); onChange(); }} /> meerdere</label>
        <label title="Achteraan bij bestelling"><input type="checkbox" checked={!!menu.appendToEnd} onChange={async (e) => { await api.updateChoiceMenu(menu.id, { appendToEnd: e.target.checked }); onChange(); }} /> achteraan</label>
        <button className="danger" onClick={async () => { if (confirm('Menu verwijderen?')) { await api.deleteChoiceMenu(menu.id); onChange(); } }}>✕</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {opts.map((o: any, idx: number) => (
          <li key={o.id} className="row" style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
            <input defaultValue={o.name} style={{ flex: 1 }} onBlur={async (e) => { if (e.target.value !== o.name) { await api.updateChoiceOption(o.id, { name: e.target.value }); onChange(); } }} />
            <input defaultValue={(o.priceCents / 100).toFixed(2)} style={{ width: 70 }} onBlur={async (e) => { const c = euroToCents(e.target.value); if (!Number.isNaN(c)) { await api.updateChoiceOption(o.id, { priceCents: c }); onChange(); } }} />
            <div className="row" style={{ gap: 4 }}>
              <button disabled={idx === 0} onClick={async () => { const ids = opts.map((x) => x.id); [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]; await api.reorderChoiceOptions(menu.id, ids); onChange(); }}>↑</button>
              <button disabled={idx === opts.length - 1} onClick={async () => { const ids = opts.map((x) => x.id); [ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]]; await api.reorderChoiceOptions(menu.id, ids); onChange(); }}>↓</button>
            </div>
            <button className="danger" onClick={async () => { await api.deleteChoiceOption(o.id); onChange(); }}>✕</button>
          </li>
        ))}
        <li className="row" style={{ marginTop: 6 }}>
          <input placeholder="Optie naam" value={optName} onChange={(e) => setOptName(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="€" value={optPrice} onChange={(e) => setOptPrice(e.target.value)} style={{ width: 70 }} />
          <button className="primary" onClick={addOption}>Optie toevoegen</button>
        </li>
      </ul>
    </div>
  );
}
