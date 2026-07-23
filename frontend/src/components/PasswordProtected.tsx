import { useEffect, useState } from 'react';
import { ACCESS_CODE_KEY } from '../lib/api';

export default function PasswordProtected({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    try { setAuthed(!!sessionStorage.getItem(ACCESS_CODE_KEY)); } catch { setAuthed(false); }
  }, []);

  if (authed === null) return null;
  if (authed) return <>{children}</>;
  return <Gate onOk={() => setAuthed(true)} />;
}

function Gate({ onOk }: { onOk: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/verify-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      }).then((x) => x.json());
      // The server re-checks this code on every admin request; stash it so
      // subsequent API calls can send it as the x-access-code header.
      if (r.ok) { try { sessionStorage.setItem(ACCESS_CODE_KEY, code); } catch {} onOk(); } else setErr('Onjuiste code');
    } catch { setErr('Verbindingsfout'); } finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <div className="card">
        <h1>🔒 Toegang</h1>
        <p className="muted">Voer de toegangscode in.</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Code"
        />
        {err && <div className="error">{err}</div>}
        <button className="primary block" disabled={busy || !code} onClick={submit}>Inloggen</button>
      </div>
    </div>
  );
}
