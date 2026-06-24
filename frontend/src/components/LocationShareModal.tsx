import { useNavigate } from 'react-router-dom';

// Location-sharing prompt shown after a delivery order is placed.
// All three languages (NL/FR/EN) shown at once so the customer finds theirs.
// "OK" sends the customer straight to the order-tracking page, which auto-starts
// GPS streaming on mount (browser will prompt for permission then).
// "Not now" is intentionally small/muted to nudge sharing — delivery is
// very hard at a busy plaza without it.

export default function LocationShareModal({ token, onClose }: { token: string; onClose: () => void }) {
  const navigate = useNavigate();

  // Both buttons go to the track page. The track page auto-requests GPS on mount.
  // The difference is just intent: OK = "yes I'll share", skip = "maybe later".
  // In both cases the browser permission prompt appears once on the track page.
  const go = () => {
    navigate(`/o/${token}?share=1`);
    onClose();
  };
  const skip = () => {
    navigate(`/o/${token}`);
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" style={overlay}>
      <div className="card" style={{ maxWidth: 440, width: '92%', padding: 20 }}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>📍</div>

        {/* Dutch */}
        <LangBlock
          flag="🇧🇪"
          title="Deel je locatie"
          why="Zodat onze bezorger jou snel vindt op de drukke kermis. We zien je locatie alleen tijdens deze bestelling."
          btn="Sta locatie delen toe"
        />
        {/* French */}
        <LangBlock
          flag="🇫🇷"
          title="Partagez votre position"
          why="Pour que notre livreur vous trouve rapidement sur la kermesse animée. Nous ne voyons votre position que pendant cette commande."
          btn="Autoriser le partage de position"
        />
        {/* English */}
        <LangBlock
          flag="🇬🇧"
          title="Share your location"
          why="So our courier can find you quickly at the busy fair. We only see your location during this order."
          btn="Allow location sharing"
        />

        <button className="primary block" style={{ fontSize: 17, height: 52, marginTop: 16 }} onClick={go}>
          📍 OK
        </button>

        {/* Deliberately small and muted — we want people to share. */}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={skip} style={{ fontSize: 12, color: 'var(--muted)', background: 'transparent', border: 'none', textDecoration: 'underline', padding: '4px 8px' }}>
            niet nu / non merci / not now
          </button>
        </div>
      </div>
    </div>
  );
}

function LangBlock({ flag, title, why, btn }: { flag: string; title: string; why: string; btn: string }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="row" style={{ gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 18 }}>{flag}</span>
        <strong>{title}</strong>
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>{why}</div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 };

