import { useState } from 'react';
import * as api from '../lib/api';

export default function PrepScreensAdmin({ screens, onChange }: { screens: any[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [isTakeaway, setIsTakeaway] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    await api.createPrepScreen(name.trim(), isTakeaway);
    setName(''); setIsTakeaway(false); onChange();
  };

  return (
    <div className="col">
      <div className="section-card">
        <h2>Bereidingsschermen</h2>
        <p className="muted" style={{ fontSize: 13 }}>Elk scherm krijgt zijn eigen pagina <code>/screen/:slug</code> voor een apart toestel. Standaard: Keuken, Bar, Afhalen.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="Naam (bv. Cocktailbar)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <label><input type="checkbox" checked={isTakeaway} onChange={(e) => setIsTakeaway(e.target.checked)} /> Afhaal-flow (Bezig → Onderweg)</label>
          <button className="primary" onClick={add}>Toevoegen</button>
        </div>
      </div>

      <div className="section-card">
        <table className="data">
          <thead><tr><th>Naam</th><th>Slug</th><th>Afhalen</th><th></th></tr></thead>
          <tbody>
            {screens.map((s) => (
              <tr key={s.id}>
                <td><a href={`/screen/${s.slug}`} target="_blank" rel="noreferrer"><strong>{s.name}</strong> ↗</a></td>
                <td><code>{s.slug}</code></td>
                <td>
                  <label><input type="checkbox" checked={!!s.isTakeaway} onChange={async (e) => { await api.updatePrepScreen(s.id, { isTakeaway: e.target.checked }); onChange(); }} /></label>
                </td>
                <td><button className="danger" onClick={async () => { if (confirm('Scherm verwijderen?')) { await api.deletePrepScreen(s.id); onChange(); } }}>Verwijderen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
