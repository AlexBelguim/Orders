import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';

// Customer lands here after Mollie redirects back.
// Polls payment status — once PAID, redirect to the track page.
export default function PaymentPendingPage() {
  const [params] = useSearchParams();
  const orderId = Number(params.get('order'));
  const [status, setStatus] = useState<'checking' | 'paid' | 'failed' | 'pending'>('checking');
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        // Get the order to find its cancelToken (for the track link)
        if (!token) {
          const orders = await api.getOrders({ status: 'ALL' });
          const o = orders.find((x: any) => x.id === orderId);
          if (o?.cancelToken) setToken(o.cancelToken);
        }

        const r = await api.getPaymentStatus(orderId);
        if (r.status === 'PAID' || r.paid) {
          setStatus('paid');
          return; // stop polling
        }
        if (r.status === 'FAILED' || r.status === 'EXPIRED' || r.status === 'CANCELED') {
          setStatus('failed');
          return;
        }
        // Still pending — keep polling (max 60 attempts = ~2 min)
        if (attempts < 60) {
          setStatus('pending');
          setTimeout(poll, 2000);
        } else {
          setStatus('failed'); // timeout
        }
      } catch {
        if (attempts < 60) setTimeout(poll, 2000);
        else setStatus('failed');
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [orderId]);

  if (!orderId) return <div className="track"><div className="card"><p>Geen bestelling opgegeven.</p></div></div>;

  return (
    <div className="track">
      <div className="card" style={{ textAlign: 'center' }}>
        {status === 'checking' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💳</div>
            <h2>Betaling controleren…</h2>
            <p className="muted">We controleren je betaling. Dit kan een paar seconden duren.</p>
          </>
        )}
        {status === 'pending' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
            <h2>Betaling in behandeling</h2>
            <p className="muted">We wachten op bevestiging van je bank.</p>
          </>
        )}
        {status === 'paid' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <h2 style={{ color: 'var(--success)' }}>Betaald!</h2>
            <p>Je bestelling is bevestigd en wordt bereid.</p>
            {token && <p style={{ marginTop: 12 }}><a href={`/o/${token}`} className="primary" style={{ display: 'inline-block', padding: '12px 18px', borderRadius: 8, background: 'var(--primary)', color: '#fff', textDecoration: 'none' }}>Volg je bestelling →</a></p>}
            <p style={{ marginTop: 8 }}><a href="/" className="muted">Terug naar menu</a></p>
          </>
        )}
        {status === 'failed' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>❌</div>
            <h2 style={{ color: 'var(--danger)' }}>Betaling mislukt</h2>
            <p>De betaling is niet gelukt of is verlopen.</p>
            <p className="muted" style={{ marginTop: 8 }}>Bel ons als je denkt dat er iets fout ging.</p>
            <p style={{ marginTop: 8 }}><a href="/" className="muted">Terug naar menu</a></p>
          </>
        )}
      </div>
    </div>
  );
}
