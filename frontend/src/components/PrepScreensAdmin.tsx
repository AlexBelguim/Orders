import { useState } from 'react';
import * as api from '../lib/api';
import { screenPauseState, nextAt } from '../lib/menu';
import TimeInput from './TimeInput';

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
          <thead><tr><th>Naam</th><th>Slug</th><th>Afhalen</th><th>Snelle modus</th><th></th></tr></thead>
          <tbody>
            {screens.map((s) => (
              <tr key={s.id}>
                <td><a href={`/screen/${s.slug}`} target="_blank" rel="noreferrer"><strong>{s.name}</strong> ↗</a></td>
                <td><code>{s.slug}</code></td>
                <td>
                  <label><input type="checkbox" checked={!!s.isTakeaway} onChange={async (e) => { await api.updatePrepScreen(s.id, { isTakeaway: e.target.checked }); onChange(); }} /></label>
                </td>
                <td>
                  <label title="Eén tik voor de hele bestelling, geen items apart aanklikken. Voor snelle uitgifte (bv. Bar) — niet voor bereiding die tijd kost."><input type="checkbox" checked={!!s.quickMode} onChange={async (e) => { await api.updatePrepScreen(s.id, { quickMode: e.target.checked }); onChange(); }} /></label>
                </td>
                <td><button className="danger" onClick={async () => { if (confirm('Scherm verwijderen?')) { await api.deletePrepScreen(s.id); onChange(); } }}>Verwijderen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-card">
        <h2>⏸ Pauze / rush-uren</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Tijdens een pauze kunnen klanten niets bestellen dat op dat scherm bereid wordt — de rest van het menu blijft gewoon beschikbaar.
          Stel vaste rush-uren in (elke dag automatisch), of pauzeer meteen met de knoppen. Op het scherm zelf staat ook een pauzeknop.
        </p>
        {screens.map((s) => <PauseControls key={s.id} screen={s} onChange={onChange} />)}
      </div>
    </div>
  );
}

// Per-screen rush-pause controls: daily window + customer message + manual
// pauzeer-nu / hervat. Mirrors the button on the prep screen page itself.
function PauseControls({ screen, onChange }: { screen: any; onChange: () => void }) {
  const st = screenPauseState(screen);
  const patch = async (data: any) => { await api.updatePrepScreen(screen.id, data); onChange(); };
  const pauseNow = (mins: number) => patch({ pauseOverridePaused: true, pauseOverrideUntil: new Date(Date.now() + mins * 60000).toISOString() });
  const resume = () => {
    const ovUntil = screen.pauseOverrideUntil ? new Date(screen.pauseOverrideUntil) : null;
    const manualActive = !!(ovUntil && ovUntil.getTime() > Date.now() && screen.pauseOverridePaused);
    return patch(manualActive
      ? { pauseOverridePaused: false, pauseOverrideUntil: null }
      : { pauseOverridePaused: false, pauseOverrideUntil: nextAt(screen.pauseUntil)?.toISOString() ?? null });
  };
  return (
    <div className="pause-admin-row">
      <div className="pause-admin-head">
        <strong>{screen.name}</strong>
        {st.paused
          ? <span className="chip pause-chip">⏸ Gepauzeerd{st.until ? ` tot ${st.until}` : ''}</span>
          : <span className="chip">● neemt bestellingen aan</span>}
        <div className="spacer" />
        {st.paused
          ? <button className="btn-resume" onClick={resume}>▶ Hervat nu</button>
          : (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn-pause" onClick={() => pauseNow(30)}>⏸ 30 min</button>
              <button className="btn-pause" onClick={() => pauseNow(60)}>⏸ 1 uur</button>
            </div>
          )}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 10 }}>
        <label className="muted" style={{ fontSize: 13 }}>Elke dag van</label>
        <TimeInput value={screen.pauseFrom} onCommit={(v) => patch({ pauseFrom: v })} placeholder="11:30" />
        <label className="muted" style={{ fontSize: 13 }}>tot</label>
        <TimeInput value={screen.pauseUntil} onCommit={(v) => patch({ pauseUntil: v })} placeholder="13:30" />
        {(screen.pauseFrom || screen.pauseUntil) && (
          <button onClick={() => patch({ pauseFrom: null, pauseUntil: null })}>✕ Geen vaste uren</button>
        )}
      </div>
      <input
        className="grow" style={{ marginTop: 8, width: '100%' }}
        placeholder={`Eigen tekst voor klanten (anders: "Onze ${screen.name.toLowerCase()} pauzeert even tijdens de drukte — …")`}
        defaultValue={screen.pauseMessage || ''}
        onBlur={(e) => { if (e.target.value !== (screen.pauseMessage || '')) patch({ pauseMessage: e.target.value }); }}
      />
    </div>
  );
}
