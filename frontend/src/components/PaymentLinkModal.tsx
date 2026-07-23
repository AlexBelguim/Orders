import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import * as api from '../lib/api';

const API = import.meta.env.VITE_API_URL || '';

// Shown when a rider (or dispatch staff) needs to get a customer paid online
// because cash isn't working out at the door. Always shows a QR the rider can
// hold up themselves — email is a bonus, not a customer's phone always has one
// on file — and flips to a "paid" state live once Mollie confirms.
export default function PaymentLinkModal({ orderId, onClose, onPaid }: { orderId: number; onClose: () => void; onPaid?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'paid'>('loading');
  const [data, setData] = useState<{ checkoutUrl: string; qrDataUrl: string; emailed: boolean; hasEmail: boolean } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.resendPaymentLink(orderId);
        if (cancelled) return;
        setData(r);
        setState('ready');
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || 'Betaallink kon niet worden aangemaakt');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  useEffect(() => {
    const sock = io(API, { transports: ['websocket', 'polling'] });
    sock.on('paymentUpdated', (p: { orderId: number; status: string }) => {
      if (p.orderId === orderId && p.status === 'PAID') {
        setState('paid');
        onPaid?.();
      }
    });
    return () => { sock.disconnect(); };
  }, [orderId, onPaid]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        {state === 'loading' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="muted">Betaallink aanmaken…</div>
          </div>
        )}
        {state === 'error' && (
          <>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 700, fontSize: 19, textAlign: 'center' }}>Kon geen betaallink maken</div>
            <div className="muted" style={{ textAlign: 'center', fontSize: 14, margin: '8px 0 20px' }}>{err}</div>
            <button className="block" onClick={onClose}>Sluiten</button>
          </>
        )}
        {state === 'paid' && (
          <>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 19, textAlign: 'center' }}>Betaald!</div>
            <div className="muted" style={{ textAlign: 'center', fontSize: 14, margin: '8px 0 20px' }}>De klant heeft zonet betaald.</div>
            <button className="primary block" onClick={onClose}>Sluiten</button>
          </>
        )}
        {state === 'ready' && data && (
          <>
            <div style={{ fontWeight: 700, fontSize: 19, textAlign: 'center', marginBottom: 4 }}>Betaallink</div>
            <div className="muted" style={{ textAlign: 'center', fontSize: 13, marginBottom: 14 }}>Laat de klant deze code scannen met hun eigen telefoon.</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <img src={data.qrDataUrl} alt="Betaal QR-code" style={{ width: 200, height: 200, borderRadius: 8 }} />
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-all', marginBottom: 10 }}>{data.checkoutUrl}</div>
            {data.hasEmail && (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', marginBottom: 10 }}>
                {data.emailed ? '✓ Ook verzonden per e-mail' : '⚠️ E-mail versturen is mislukt — gebruik de QR-code'}
              </div>
            )}
            <div className="muted" style={{ fontSize: 13, textAlign: 'center', marginBottom: 14 }}>⏳ Wachten op betaling…</div>
            <button className="block" onClick={onClose}>Sluiten</button>
          </>
        )}
      </div>
    </div>
  );
}
