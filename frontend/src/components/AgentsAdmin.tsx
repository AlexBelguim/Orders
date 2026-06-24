import { useEffect, useState } from 'react';
import * as api from '../lib/api';

export default function AgentsAdmin() {
  const [agents, setAgents] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const load = () => api.getAgents().then(setAgents);
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    await api.createAgent(name.trim(), phone.trim() || undefined);
    setName(''); setPhone(''); load();
  };

  return (
    <div className="col">
      <div className="section-card">
        <h2>Bezorgers</h2>
        <p className="muted" style={{ fontSize: 13 }}>Elke bezorger opent <code>/bezorger/:code</code> op zijn telefoon om GPS te delen en leveringen te zien.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="Naam" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Telefoon (optioneel)" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={add}>Toevoegen</button>
        </div>
      </div>

      <div className="section-card">
        {agents.length === 0 && <div className="muted">Nog geen bezorgers.</div>}
        <table className="data">
          <thead><tr><th>Naam</th><th>Telefoon</th><th>Code</th><th>Actief</th><th></th></tr></thead>
          <tbody>
            {agents.map((a) => {
              const activeCount = (a.assignments || []).filter((as: any) => as.status === 'ASSIGNED' || as.status === 'PICKED_UP').length;
              return (
                <tr key={a.id}>
                  <td>
                    <input defaultValue={a.name} onBlur={(e) => e.target.value.trim() && api.updateAgent(a.id, { name: e.target.value })} />
                    {activeCount > 0 && <span className="chip" style={{ marginLeft: 6, background: 'var(--warning)' }}>{activeCount} actief</span>}
                  </td>
                  <td><input defaultValue={a.phone || ''} onBlur={(e) => api.updateAgent(a.id, { phone: e.target.value })} /></td>
                  <td>
                    <a href={`/bezorger/${a.code}`} target="_blank" rel="noreferrer"><code>{a.code}</code> ↗</a>
                  </td>
                  <td>
                    <label><input type="checkbox" checked={!!a.active} onChange={async (e) => { await api.updateAgent(a.id, { active: e.target.checked }); load(); }} /></label>
                  </td>
                  <td><button className="danger" onClick={async () => { if (confirm('Bezorger verwijderen?')) { await api.deleteAgent(a.id); load(); } }}>Verwijderen</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
