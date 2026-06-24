import { useEffect, useState } from 'react';
import * as api from '../lib/api';

export default function SettingsAdmin() {
  const [s, setS] = useState<Record<string, string>>({});
  const [qrBase, setQrBase] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [savedFlash, setSavedFlash] = useState('');
  const [clearStep, setClearStep] = useState<'idle' | 'confirm' | 'working'>('idle');
  const [clearStatus, setClearStatus] = useState('');

  const load = async () => {
    const all = await api.getSettings();
    setS(all);
    setQrBase(all.PUBLIC_URL || '');
  };
  useEffect(() => { load(); }, []);

  const set = (k: string, v: string) => setS((p) => ({ ...p, [k]: v }));

  const save = async (k: string) => { await api.putSetting(k, s[k] ?? ''); setSavedFlash(`${k} opgeslagen`); setTimeout(() => setSavedFlash(''), 1500); };
  const saveQr = async () => { await api.putQrBaseUrl(qrBase); setSavedFlash('Basis-URL opgeslagen'); setTimeout(() => setSavedFlash(''), 1500); };

  const testEmailConn = async () => {
    setEmailStatus('Testen…');
    try {
      // persist first so the test uses current values
      await api.putSettings({ smtp_host: s.smtp_host || '', smtp_port: s.smtp_port || '587', smtp_user: s.smtp_user || '', smtp_pass: s.smtp_pass || '' });
      const r = await api.testEmail();
      setEmailStatus(r.ok ? '✅ Verbinding OK' : '❌ Geen verbinding (controleer instellingen)');
    } catch (e: any) { setEmailStatus(`❌ ${e?.message || 'fout'}`); }
  };

  // Clear all orders/sales (payments, assignments, GPS pings) but keep the
  // product catalogue, menus, locations, tables, agents and settings.
  const runClearOrders = async () => {
    setClearStep('working');
    setClearStatus('Wissen…');
    try {
      const r = await api.clearOrders();
      const total = Object.values(r.deleted as Record<string, number>).reduce((a, b) => a + b, 0);
      setClearStatus(`✅ Gewist — ${total} rij(en) verwijderd.`);
      setClearStep('idle');
    } catch (e: any) {
      setClearStatus(`❌ ${e?.message || 'fout'}`);
      setClearStep('confirm');
    }
  };

  return (
    <div className="col">
      {savedFlash && <div className="chip primary" style={{ alignSelf: 'flex-start' }}>{savedFlash}</div>}

      {/* QR / Public URL */}
      <div className="section-card">
        <h2>QR &amp; openbare URL</h2>
        <p className="muted" style={{ fontSize: 13 }}>De openbare HTTPS-URL (Cloudflare Tunnel). QR-codes wijzen hierheen.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={qrBase} onChange={(e) => setQrBase(e.target.value)} placeholder="https://jouw-domein.example.com" style={{ flex: 1 }} />
          <button className="primary" onClick={saveQr}>Opslaan</button>
        </div>
      </div>

      {/* Access code */}
      <div className="section-card">
        <h2>Toegangscode</h2>
        <p className="muted" style={{ fontSize: 13 }}>Code voor admin / schermen / statistieken.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={s.ACCESS_CODE || ''} onChange={(e) => set('ACCESS_CODE', e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={() => save('ACCESS_CODE')}>Opslaan</button>
        </div>
      </div>

      {/* Restaurant identity */}
      <div className="section-card">
        <h2>Restaurant</h2>
        <div className="col" style={{ marginTop: 8 }}>
          <div className="row"><label style={{ width: 160 }}>Naam</label><input value={s.restaurant_name || ''} onChange={(e) => set('restaurant_name', e.target.value)} style={{ flex: 1 }} /></div>
          <div className="row"><label style={{ width: 160 }}>E-mail (antwoord-adres)</label><input value={s.restaurant_email || ''} onChange={(e) => set('restaurant_email', e.target.value)} style={{ flex: 1 }} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="primary" onClick={async () => { await api.putSettings({ restaurant_name: s.restaurant_name || '', restaurant_email: s.restaurant_email || '' }); setSavedFlash('Opgeslagen'); setTimeout(() => setSavedFlash(''), 1500); }}>Opslaan</button>
          </div>
        </div>
      </div>

      {/* SMTP */}
      <div className="section-card">
        <h2>E-mail (SMTP)</h2>
        <p className="muted" style={{ fontSize: 13 }}>Gmail: host <code>smtp.gmail.com</code>, poort <code>587</code>, en een <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">App-wachtwoord</a> (niet je gewone wachtwoord).</p>
        <div className="col" style={{ marginTop: 8 }}>
          <div className="row"><label style={{ width: 160 }}>SMTP host</label><input value={s.smtp_host || ''} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" style={{ flex: 1 }} /></div>
          <div className="row"><label style={{ width: 160 }}>SMTP poort</label><input value={s.smtp_port || '587'} onChange={(e) => set('smtp_port', e.target.value)} style={{ width: 100 }} /></div>
          <div className="row"><label style={{ width: 160 }}>Gebruiker</label><input value={s.smtp_user || ''} onChange={(e) => set('smtp_user', e.target.value)} placeholder="jouw@gmail.com" style={{ flex: 1 }} /></div>
          <div className="row"><label style={{ width: 160 }}>Wachtwoord</label><input type="password" value={s.smtp_pass || ''} onChange={(e) => set('smtp_pass', e.target.value)} style={{ flex: 1 }} /></div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{emailStatus}</span>
            <div className="row">
              <button onClick={testEmailConn}>Test verbinding</button>
              <button className="primary" onClick={async () => { await api.putSettings({ smtp_host: s.smtp_host || '', smtp_port: s.smtp_port || '587', smtp_user: s.smtp_user || '', smtp_pass: s.smtp_pass || '' }); setSavedFlash('Opgeslagen'); setTimeout(() => setSavedFlash(''), 1500); }}>Opslaan</button>
            </div>
          </div>
        </div>
      </div>

      {/* Mollie (placeholder until Phase 7) */}
      <div className="section-card">
        <h2>Betalingen (Mollie)</h2>
        <p className="muted" style={{ fontSize: 13 }}>Vul je Mollie API-sleutel in om online betalingen (Bancontact, Apple Pay, Google Pay) te activeren. Gebruik <code>test_...</code> voor testen, <code>live_...</code> voor productie.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ width: 160 }}>Mollie API-sleutel</label>
          <input type="password" value={s.mollie_api_key || ''} onChange={(e) => set('mollie_api_key', e.target.value)} placeholder="live_... of test_..." style={{ flex: 1 }} />
          <button className="primary" onClick={async () => { await api.putSettings({ mollie_api_key: s.mollie_api_key || '' }); setSavedFlash('Mollie sleutel opgeslagen'); setTimeout(() => setSavedFlash(''), 1500); }}>Opslaan</button>
        </div>
        {s.mollie_api_key && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>✓ {s.mollie_api_key.startsWith('test_') ? 'Test modus actief' : 'Live modus'}</div>}
      </div>

      {/* Danger zone — wipe orders/sales, keep products */}
      <div className="section-card" style={{ borderColor: 'var(--danger)' }}>
        <h2 style={{ color: 'var(--danger)' }}>Gevarenzone — Bestellingen &amp; verkopen wissen</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Verwijdert álle bestellingen, bestelregels, betalingen, bezorg-opdrachten en GPS-pings.
          Producten, menu&apos;s, keuzes, locaties, tafels, schermen, bezorgers en instellingen blijven bewaard.
          Statistieken en commissie-rapporten worden hiermee gereset. <strong>Onomkeerbaar.</strong>
        </p>
        {clearStatus && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{clearStatus}</div>}
        {clearStep === 'idle' && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="danger" onClick={() => { setClearStatus(''); setClearStep('confirm'); }}>Bestellingen &amp; verkopen wissen…</button>
          </div>
        )}
        {clearStep === 'confirm' && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 13 }}>Zeker weten? Dit kan niet ongedaan gemaakt worden.</span>
            <button className="danger" onClick={runClearOrders}>Ja, alles wissen</button>
            <button onClick={() => setClearStep('idle')}>Annuleren</button>
          </div>
        )}
        {clearStep === 'working' && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="danger" disabled>Wissen…</button>
          </div>
        )}
      </div>
    </div>
  );
}
