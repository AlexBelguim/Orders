import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { euro, euroToCents } from '../lib/format';
import ProductsAdmin from '../components/ProductsAdmin';
import LocationsAdmin from '../components/LocationsAdmin';
import ChoicesAdmin from '../components/ChoicesAdmin';
import TablesAdmin from '../components/TablesAdmin';
import PrepScreensAdmin from '../components/PrepScreensAdmin';
import SettingsAdmin from '../components/SettingsAdmin';
import AgentsAdmin from '../components/AgentsAdmin';

const TABS = ['Producten', 'Locaties', 'Tafels', 'Bereiding', 'Keuzes', 'Bezorgers', 'Instellingen'] as const;
type Tab = typeof TABS[number];

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('Producten');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [screens, setScreens] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const loadShared = async () => {
    const [p, s, l] = await Promise.all([api.getProfiles(), api.getPrepScreens(), api.getLocations()]);
    setProfiles(p); setScreens(s); setLocations(l);
  };
  useEffect(() => { loadShared(); }, []);

  return (
    <div className="admin">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1>Up t Gemak — Beheer</h1>
        <div className="row">
          <a href="/stats" className="chip">📊 Statistieken</a>
          <a href="/dispatch" className="chip">🛵 Bezorg-dispatch</a>
          {screens.map((s) => (
            <a key={s.id} href={`/screen/${s.slug}`} className="chip" title={s.isTakeaway ? 'Afhalen' : 'Bereiding'}>🍳 {s.name}</a>
          ))}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Producten' && (
        <ProductsAdmin profiles={profiles} screens={screens} onChange={loadShared} />
      )}
      {tab === 'Locaties' && (
        <LocationsAdmin profiles={profiles} screens={screens} locations={locations} onChange={loadShared} />
      )}
      {tab === 'Tafels' && (
        <TablesAdmin locations={locations} screens={screens} onChange={loadShared} />
      )}
      {tab === 'Bereiding' && (
        <PrepScreensAdmin screens={screens} onChange={loadShared} />
      )}
      {tab === 'Keuzes' && (
        <ChoicesAdmin />
      )}
      {tab === 'Bezorgers' && (
        <AgentsAdmin />
      )}
      {tab === 'Instellingen' && (
        <SettingsAdmin />
      )}
    </div>
  );
}
