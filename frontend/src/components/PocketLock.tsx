import { useCallback, useEffect, useRef, useState } from 'react';

// "Zakmodus" for the rider's phone.
//
// Two jobs while the phone is in a pocket:
//  1. Keep the screen awake (Screen Wake Lock). Not cosmetic — when the screen
//     sleeps the browser throttles timers and geolocation, so the GPS pings
//     stop and the customer's tracking map freezes mid-delivery.
//  2. Swallow every touch, so a leg can't tap "Geleverd" or hang up a call.
//
// Unlock is a deliberate 1.5s press — a stray poke can't do it.
// The overlay is near-black on purpose: the screen is on for the whole ride,
// so keep the battery cost (and OLED draw) as low as we can.

const HOLD_MS = 1500;

export default function PocketLock({
  onUnlock, gpsSharing, deliveries,
}: {
  onUnlock: () => void;
  gpsSharing: boolean;
  deliveries: number;
}) {
  const [held, setHeld] = useState(0); // 0..1 progress of the unlock press
  const [wake, setWake] = useState<'on' | 'off' | 'unsupported'>('off');
  const sentinel = useRef<any>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);

  // --- screen wake lock (re-acquired whenever we become visible again: the
  // lock is dropped by the browser on tab switch / incoming call) ---
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      const nav: any = navigator;
      if (!('wakeLock' in nav)) { setWake('unsupported'); return; }
      try {
        const s = await nav.wakeLock.request('screen');
        if (cancelled) { try { await s.release(); } catch {} return; }
        sentinel.current = s;
        setWake('on');
        s.addEventListener?.('release', () => setWake('off'));
      } catch { setWake('off'); } // e.g. battery saver refuses it
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    // Block page scrolling underneath while locked.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      document.body.style.overflow = prevOverflow;
      try { sentinel.current?.release(); } catch {}
      sentinel.current = null;
    };
  }, []);

  // --- hold-to-unlock ---
  // A timer decides when it unlocks; requestAnimationFrame only animates the
  // bar. rAF stops entirely when the page isn't rendering, so driving the
  // unlock from it could leave the rider unable to get back in.
  const endHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setHeld(0);
  }, []);

  const beginHold = useCallback(() => {
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => { timer.current = null; onUnlock(); }, HOLD_MS);
    const tick = () => {
      setHeld(Math.min(1, (Date.now() - startedAt.current) / HOLD_MS));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [onUnlock]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div
      className="pocket-lock"
      role="dialog"
      aria-modal="true"
      aria-label="Scherm vergrendeld — houd ingedrukt om te ontgrendelen"
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={endHold}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pl-lock">🔒</div>
      <div className="pl-title">Scherm vergrendeld</div>

      <div className="pl-status">
        <div className={gpsSharing ? 'pl-ok' : 'pl-warn'}>
          {gpsSharing ? '● Locatie wordt gedeeld' : '⚠ Locatie staat UIT — klant ziet je niet rijden'}
        </div>
        <div className="pl-dim">
          {deliveries === 0 ? 'Geen actieve leveringen' : `${deliveries} actieve levering${deliveries > 1 ? 'en' : ''}`}
        </div>
        {wake === 'unsupported' && <div className="pl-dim">Scherm-wakker-houden wordt niet ondersteund op dit toestel.</div>}
        {wake === 'off' && <div className="pl-dim">Scherm kan vanzelf uitgaan (batterijbesparing?).</div>}
      </div>

      <div className="pl-hold">
        <div className="pl-hold-label">{held > 0 ? 'Blijf vasthouden…' : 'Houd ingedrukt om te ontgrendelen'}</div>
        <div className="pl-bar"><div className="pl-bar-fill" style={{ width: `${Math.round(held * 100)}%` }} /></div>
      </div>
    </div>
  );
}
