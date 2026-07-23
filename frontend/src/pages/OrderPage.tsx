import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import * as api from '../lib/api';
import { euro } from '../lib/format';
import { filterTreeByExclusions, screenPauseState, inDailyWindow } from '../lib/menu';

type Mode = 'TABLE' | 'LOCATION';

const API = import.meta.env.VITE_API_URL || '';

// Pure helper: flip a variant's soldOut flag inside the nested product tree.
function applySoldOut(profiles: any[], variantId: number, soldOut: boolean) {
  return profiles.map((profile) => ({
    ...profile,
    categories: (profile.categories || []).map((cat: any) => ({
      ...cat,
      products: (cat.products || []).map((prod: any) => ({
        ...prod,
        variants: (prod.variants || []).map((v: any) => (v.id === variantId ? { ...v, soldOut } : v)),
      })),
    })),
  }));
}

export default function OrderPage() {
  const { tableCode, locationCode } = useParams();
  const navigate = useNavigate();
  const mode: Mode = tableCode ? 'TABLE' : 'LOCATION';

  const [location, setLocation] = useState<any | null>(null);
  const [profilesData, setProfilesData] = useState<{ id: number; name: string; categories: any[] }[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cart, setCart] = useState<any[]>([]);
  const [view, setView] = useState<'MENU' | 'CART'>('MENU');
  const [noteTarget, setNoteTarget] = useState<null | { vId: number; key?: string }>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [choiceFlow, setChoiceFlow] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  // Rush pause: live per-screen pause fields, keyed by screen id. Starts empty
  // (the tree/location payloads embed the state at load time); socket pushes
  // merge over that when staff hits "pauzeer nu".
  const [screenStatus, setScreenStatus] = useState<Record<number, any>>({});
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false); // online pay → Mollie checkout
  const [success, setSuccess] = useState<any | null>(null);

  // delivery-only form state
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [payMethod, setPayMethod] = useState<'ONLINE' | 'ON_DELIVERY'>('ON_DELIVERY');
  // Set once Mollie has refused to start a payment — the online option is then
  // disabled for this session so the customer can't hit the same wall twice.
  const [onlineUnavailable, setOnlineUnavailable] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        let loc: any;
        if (mode === 'TABLE') {
          const table = await api.getTableByCode(tableCode!);
          if (!table) { setErr('Tafel niet gevonden'); setLoading(false); return; }
          // A standalone eat-in table (e.g. the restaurant's own tables) has no
          // location at all — that's a valid setup, not an error. Fall back to
          // a plain EAT_IN location so the menu still loads.
          loc = table.location || { kind: 'EAT_IN' };
        } else {
          loc = await api.getLocationByCode(locationCode!);
        }
        if (!loc) { setErr('Locatie niet gevonden'); setLoading(false); return; }
        setLocation(loc);

        const ids = (loc.allowedProfiles || []).map((ap: any) => ap.profileId || ap.profile?.id).filter(Boolean);
        const useIds = ids.length ? ids : [];
        const trees = useIds.length
          ? await Promise.all(useIds.map((pid: number) => api.getProductTree(pid)))
          : [await api.getProductTree()];

        const names: Record<number, string> = {};
        (loc.allowedProfiles || []).forEach((ap: any) => { const id = ap.profileId || ap.profile?.id; if (id) names[id] = ap.profile?.name || 'Menu'; });

        const exclCats = new Set<number>((loc.excludedCategories || []).map((x: any) => x.categoryId));
        const exclProds = new Set<number>((loc.excludedProducts || []).map((x: any) => x.productId));

        const arr = (useIds.length ? useIds : [undefined]).map((pid: any, i: number) => {
          const filtered = filterTreeByExclusions(trees[i], exclCats, exclProds);
          return { id: pid ?? 0, name: pid ? (names[pid] || 'Menu') : 'Menu', categories: filtered.categories || [] };
        }).filter((p) => p.categories.length > 0);
        setProfilesData(arr);

        // Expand profiles + categories by default so the menu shows products
        // immediately (matches the redesign mockup — no empty accordion).
        const initOpen: Record<string, boolean> = {};
        const multi = arr.length > 1;
        arr.forEach((p) => {
          if (multi) initOpen[`p-${p.id}`] = true;
          (p.categories || []).forEach((cat: any) => {
            initOpen[multi ? `p${p.id}-c${cat.id}` : String(cat.id)] = true;
          });
        });
        setOpen(initOpen);
      } catch (e: any) {
        setErr(e?.message || 'Fout bij laden');
      } finally {
        setLoading(false);
      }
    })();
  }, [tableCode, locationCode]);

  // Live sold-out updates: staff can mark an item sold out at any time. Without
  // this, a page opened before the change would keep showing (and let people
  // add/keep) an item the kitchen no longer has.
  useEffect(() => {
    const sock = io(API, { transports: ['websocket', 'polling'] });
    sock.on('variantSoldOut', (p: { variantId: number; soldOut: boolean }) => {
      setProfilesData((prev) => applySoldOut(prev, p.variantId, p.soldOut));
      if (p.soldOut) {
        const hit = cartRef.current.find((l) => l.variantId === p.variantId);
        if (hit) {
          setCart((c) => c.filter((l) => l.variantId !== p.variantId));
          setNotice(`"${hit.name}" is niet meer beschikbaar en is uit je mandje verwijderd.`);
        }
      }
    });
    // Staff paused/resumed a prep screen (rush pause) — update live.
    sock.on('screenUpdated', (s: any) => {
      if (s && s.id) setScreenStatus((m) => ({ ...m, [s.id]: s }));
    });
    return () => { sock.disconnect(); };
  }, []);

  // The schedule-based pause flips at a clock time, not on an event — re-render
  // every 30s so the banner and greyed items appear/disappear on their own.
  const [, setPauseTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPauseTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const isDelivery = location?.kind === 'DELIVERY';

  // Opening hours: outside the location's open window nothing can be ordered.
  // Re-evaluated every render (the 30s pause tick keeps it live at boundaries).
  const isClosed = !!location && inDailyWindow(location.openFrom, location.openUntil) === false;
  const openLabel = location?.openFrom && location?.openUntil
    ? `${location.openFrom} tot ${location.openUntil === '00:00' ? '24:00' : location.openUntil}`
    : '';

  const add = (variant: any, product: any) => {
    if (isClosed) return; // buttons are disabled too — belt and braces
    const pmenus = (product.productMenus || []).slice().sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));
    const menus = pmenus.map((pm: any) => ({
      name: pm.menu?.name ?? pm.menuName,
      requireOne: !!(pm.menu?.requireOne),
      allowMultiple: !!(pm.menu?.allowMultiple),
      appendToEnd: !!(pm.menu?.appendToEnd),
      options: (pm.menu?.options || []).slice().sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0)),
    }));
    if (menus.length === 0) {
      setCart((c) => {
        const idx = c.findIndex((i) => i.variantId === variant.id && (!i.choices || i.choices.length === 0));
        if (idx >= 0) { const cp = [...c]; cp[idx].qty += 1; return cp; }
        const label = (variant.name && variant.name.trim()) ? `${product.name} ${variant.name}` : product.name;
        return [...c, { variantId: variant.id, name: label, unitCents: variant.priceCents, qty: 1, choices: [] }];
      });
      return;
    }
    setChoiceFlow({ product, variant, menus, idx: 0, stepSel: [], pendingSingle: menus[0].requireOne ? null : '(none)', pendingMulti: [] });
  };

  const decOne = (variantId: number, choiceKey?: string) => {
    setCart((c) => {
      const idx = c.findIndex((i) => i.variantId === variantId && (i.choiceKey || '') === (choiceKey || ''));
      if (idx < 0) return c;
      const cp = [...c]; cp[idx].qty -= 1; if (cp[idx].qty <= 0) cp.splice(idx, 1); return cp;
    });
  };
  const incLine = (variantId: number, choiceKey?: string) => {
    setCart((c) => c.map((l) => (l.variantId === variantId && (l.choiceKey || '') === (choiceKey || '')) ? { ...l, qty: l.qty + 1 } : l));
  };

  const normKey = (variantId: number, choices: any[]) => {
    const parts = choices.map((c: any) => `${c.menuName}:${c.optionName || '(none)'}:${c.appendToEnd ? 'A' : '-'}`);
    return `${variantId}|${parts.join('|')}`;
  };

  const finalize = (flow: any, selections: any[]) => {
    const label = (flow.variant.name && flow.variant.name.trim()) ? `${flow.product.name} ${flow.variant.name}` : flow.product.name;
    const choiceKey = normKey(flow.variant.id, selections);
    const unitAdd = selections.reduce((s: number, c: any) => s + (c.priceCents || 0), 0);
    setCart((c) => {
      const idx = c.findIndex((i) => i.variantId === flow.variant.id && (i.choiceKey || '') === choiceKey);
      if (idx >= 0) { const cp = [...c]; cp[idx].qty += 1; return cp; }
      return [...c, { variantId: flow.variant.id, name: label, unitCents: flow.variant.priceCents + unitAdd, qty: 1, choices: selections, choiceKey }];
    });
  };

  // Build the OrderItemChoice entries for one step from its pending state.
  // A multi-select menu yields one entry per checked option (option order preserved
  // for a stable choiceKey); a single-select yields one entry (or an explicit "geen").
  const stepSelections = (menu: any, pendingSingle: string | null, pendingMulti: string[]) => {
    if (menu.allowMultiple) {
      return (menu.options || [])
        .filter((o: any) => pendingMulti.includes(String(o.name)))
        .map((o: any) => ({ menuName: menu.name, optionName: o.name, priceCents: Number(o.priceCents || 0), appendToEnd: !!menu.appendToEnd }));
    }
    if (pendingSingle && pendingSingle !== '(none)') {
      const opt = (menu.options || []).find((o: any) => String(o.name) === pendingSingle);
      return [{ menuName: menu.name, optionName: opt?.name || pendingSingle, priceCents: Number(opt?.priceCents || 0), appendToEnd: !!menu.appendToEnd }];
    }
    return [{ menuName: menu.name, optionName: null, priceCents: 0, appendToEnd: !!menu.appendToEnd }];
  };

  const toggleMulti = (name: string) => setChoiceFlow((f: any) => {
    if (!f) return f;
    const has = f.pendingMulti.includes(name);
    return { ...f, pendingMulti: has ? f.pendingMulti.filter((n: string) => n !== name) : [...f.pendingMulti, name] };
  });

  const cancelChoice = () => {
    if (!choiceFlow) { setChoiceFlow(null); return; }
    if (!choiceFlow.menus.some((m: any) => m.requireOne)) {
      const sels = choiceFlow.menus.flatMap((m: any) => m.allowMultiple ? [] : [{ menuName: m.name, optionName: null, priceCents: 0, appendToEnd: !!m.appendToEnd }]);
      finalize(choiceFlow, sels);
    }
    setChoiceFlow(null);
  };

  const confirmChoice = () => {
    if (!choiceFlow) return;
    const menu = choiceFlow.menus[choiceFlow.idx];
    if (menu.requireOne) {
      const ok = menu.allowMultiple ? choiceFlow.pendingMulti.length > 0 : (!!choiceFlow.pendingSingle && choiceFlow.pendingSingle !== '(none)');
      if (!ok) return;
    }
    const thisStep = stepSelections(menu, choiceFlow.pendingSingle, choiceFlow.pendingMulti);
    const nextStepSel = [...choiceFlow.stepSel.slice(0, choiceFlow.idx), thisStep];
    const nextIdx = choiceFlow.idx + 1;
    if (nextIdx >= choiceFlow.menus.length) { finalize(choiceFlow, nextStepSel.flat()); setChoiceFlow(null); }
    else {
      const nm = choiceFlow.menus[nextIdx];
      setChoiceFlow({ ...choiceFlow, idx: nextIdx, stepSel: nextStepSel, pendingSingle: nm.requireOne ? null : '(none)', pendingMulti: [] });
    }
  };

  const stepBack = () => {
    setChoiceFlow((f: any) => {
      if (!f || f.idx === 0) return f;
      const prevIdx = f.idx - 1;
      const prevMenu = f.menus[prevIdx];
      const prevSel: any[] = f.stepSel[prevIdx] || [];
      return {
        ...f, idx: prevIdx, stepSel: f.stepSel.slice(0, prevIdx),
        pendingSingle: prevMenu.allowMultiple ? null : (prevSel.find((s: any) => s.optionName)?.optionName ?? (prevMenu.requireOne ? null : '(none)')),
        pendingMulti: prevMenu.allowMultiple ? prevSel.map((s: any) => s.optionName).filter(Boolean) : [],
      };
    });
  };

  const total = cart.reduce((s, l) => s + l.unitCents * l.qty, 0);
  const itemCount = cart.reduce((a, c) => a + c.qty, 0);
  const minCents = location?.minOrderCents || 0;
  const underMin = isDelivery && minCents > 0 && total < minCents;
  const pausedCartLines = cart.map((l) => ({ line: l, pz: pauseForVariant(l.variantId) })).filter((x) => x.pz.paused);

  const submit = async () => {
    if (!cart.length) return;
    setSubmitting(true); setErr('');
    try {
      const items = cart.map((i) => ({ variantId: i.variantId, qty: i.qty, note: i.note, choices: i.choices || [] }));
      const payload: any = { items, note: orderNote || undefined };
      if (mode === 'TABLE') payload.tableCode = tableCode;
      else { payload.locationCode = locationCode; payload.customerName = customerName; payload.customerEmail = customerEmail; payload.customerPhone = customerPhone; payload.tableLabel = tableLabel; payload.payMethod = payMethod; }
      const order = await api.createOrder(payload);

      // If the customer chose online payment, create a Mollie payment and redirect.
      // Keep the cart untouched until we know we're NOT redirecting — clearing it
      // first made the emptied "Je mandje is leeg" card flash while Mollie loaded.
      if (isDelivery && payMethod === 'ONLINE') {
        try {
          const pay = await api.createPayment(order.id);
          if (!pay.checkoutUrl) throw new Error('Mollie gaf geen checkout-URL terug');
          setRedirecting(true); // show the redirect splash, not the empty cart
          window.location.href = pay.checkoutUrl;
          return;
        } catch (e: any) {
          // Fail loudly. Silently placing the order as unpaid used to send food
          // to the kitchen that nobody was ever asked to pay for, and showed the
          // rider "betaling in afwachting" instead of "cash". The server has
          // cancelled the order, so here we just keep the cart and make the
          // customer choose again.
          console.error('Payment creation failed:', e);
          setOnlineUnavailable(true);
          setPayMethod('ON_DELIVERY');
          setErr('Online betalen lukt op dit moment niet. Je bestelling is niet geplaatst en er is niets afgeschreven — kies "Bij levering" en bestel opnieuw.');
          return; // outer finally clears `submitting`
        }
      }

      // On-delivery: clear the cart and show the success screen.
      setCart([]); setOrderNote('');
      setView('MENU');
      setSuccess({ id: order.id, token: order.cancelToken, isDelivery, tableLabel });
    } catch (e: any) {
      // Sold out between page load and submit (e.g. socket update missed):
      // drop the offending line instead of leaving the customer stuck.
      const vId = e?.data?.variantId;
      const hit = vId != null ? cart.find((l) => l.variantId === vId) : null;
      if (hit) {
        setCart((c) => c.filter((l) => l.variantId !== vId));
        setProfilesData((prev) => applySoldOut(prev, vId, true));
        setErr(`"${hit.name}" is uitverkocht en is uit je mandje verwijderd. Controleer je mandje en probeer opnieuw.`);
      } else {
        setErr(e?.message || 'Bestellen mislukt');
      }
    }
    finally { setSubmitting(false); }
  };

  if (redirecting) return (
    <div className="order-page placed-page">
      <div className="placed-body" style={{ justifyContent: 'center' }}>
        <div className="placed-pin">💳</div>
        <div className="placed-h2">Je wordt doorgestuurd naar de beveiligde betaalpagina…</div>
        <div className="placed-text">Sluit dit venster niet.</div>
        <div className="placed-spinner" />
      </div>
    </div>
  );
  if (loading) return <div className="order-page"><div className="card"><p className="muted">Laden…</p></div></div>;
  if (err && !location) return <div className="order-page"><div className="card"><h2>Helaas</h2><p>{err}</p></div></div>;
  if (success) {
    // Delivery: rich "order placed → share your location" screen (mockup row 08, panel 1)
    if (success.isDelivery && success.token) {
      return (
        <div className="order-page placed-page">
          <div className="placed-success">
            <div className="placed-check">✓</div>
            <div className="placed-title">Bestelling geplaatst!</div>
            <div className="placed-sub">#{success.id} · de keuken is begonnen</div>
          </div>
          <div className="placed-body">
            <div className="placed-pin">📍</div>
            <div className="placed-h2">Deel je locatie zodat de bezorger je vindt</div>
            <div className="placed-text">Op een druk terras of de kermis zijn tafelnummers lastig. Met je live locatie loopt de bezorger recht naar je toe — sneller en geen verwarring.</div>
            <div className="placed-privacy">🔒 Alleen gedeeld met je bezorger, alleen tijdens deze levering. Stopt automatisch zodra je bestelling geleverd is.</div>
            <div className="placed-spacer" />
            <button className="primary placed-cta" onClick={() => navigate(`/o/${success.token}?share=1`)}>📍 Locatie delen</button>
            <button className="placed-skip" onClick={() => navigate(`/o/${success.token}`)}>{success.tableLabel ? `Liever niet — gebruik tafel ${success.tableLabel}` : 'Liever niet'}</button>
          </div>
        </div>
      );
    }
    // Eat-in / fallback confirmation
    return (
      <div className="order-page">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="placed-check" style={{ margin: '0 auto 12px' }}>✓</div>
          <h2>Bestelling geplaatst!</h2>
          <p className="muted">De keuken is begonnen met je bestelling.</p>
          <button className="primary block" style={{ marginTop: 16 }} onClick={() => setSuccess(null)}>Verder bestellen</button>
        </div>
      </div>
    );
  }
  if (!location) return <div className="order-page"><div className="card"><p>Locatie niet gevonden.</p></div></div>;

  const headerTitle = mode === 'TABLE' ? `Tafel ${tableCode}` : location.name;

  return (
    <div className="order-page order-redesign">
      {notice && (
        <div className="error" style={{ margin: '10px 14px', background: 'var(--warning, #b45309)', color: '#fff' }}>
          {notice}
        </div>
      )}
      {/* ===== CART / MANDJE VIEW ===== */}
      {view === 'CART' && (
        <>
          <div className="mandje-header">
            <button className="back-sq" onClick={() => setView('MENU')} aria-label="Terug">‹</button>
            <div>
              <div style={{ fontSize: 12, opacity: 0.85, letterSpacing: '0.04em' }}>{isDelivery ? `${headerTitle.toUpperCase()} · LEVERING` : headerTitle.toUpperCase()}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Mandje</div>
            </div>
          </div>

          {cart.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon">🛒</div>
              <div className="cart-empty-title">Je mandje is leeg</div>
              <div className="muted cart-empty-hint">Blader door het menu en tik op <span className="plus-inline">+</span> om iets toe te voegen.</div>
              <button className="primary" style={{ marginTop: 18 }} onClick={() => setView('MENU')}>← Terug naar menu</button>
            </div>
          ) : (
            <>
              {!isDelivery && (
                <div className="eatin-banner">
                  <span style={{ fontSize: 16 }}>🍽️</span>
                  <span>Je bestelt aan <strong>{headerTitle.toLowerCase()}</strong>. De ober brengt het — <strong>betalen doe je aan de toog</strong>.</span>
                </div>
              )}

              {/* Closed: outside opening hours the cart can't be submitted */}
              {isClosed && (
                <div className="closed-banner" style={{ marginTop: 12 }}>
                  <span className="pause-banner-icon">🌙</span>
                  <span>We zijn nu <strong>gesloten</strong>{openLabel ? <> — bestellen kan elke dag van <strong>{openLabel}</strong></> : null}. Je mandje blijft bewaard zolang je de pagina open houdt.</span>
                </div>
              )}

              {/* Rush pause: items added before the pause hit can't be ordered now */}
              {!isClosed && pausedCartLines.length > 0 && (
                <div className="pause-banner" style={{ marginTop: 12 }}>
                  <span className="pause-banner-icon">⏸</span>
                  <span>
                    {pausedCartLines.map((x) => `"${x.line.name}"`).join(', ')} kan je nu even niet bestellen
                    {pausedCartLines[0].pz.until ? <> — weer beschikbaar <strong>vanaf {pausedCartLines[0].pz.until}</strong></> : null}.
                    Haal {pausedCartLines.length === 1 ? 'het' : 'ze'} uit je mandje om de rest al te bestellen.
                  </span>
                </div>
              )}

              {/* Order review */}
              <div className="card" style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 10 }}>Jouw bestelling</h3>
                {cart.map((line) => (
                  <div key={(line.choiceKey || '') + ':' + line.variantId} className="cart-line">
                    <div className="cart-line-info">
                      <div className="cart-line-name">{line.name}</div>
                      {!!(line.choices || []).filter((c: any) => !c.appendToEnd).length && (
                        <div className="muted cart-line-sub">{groupChoices((line.choices || []).filter((c: any) => !c.appendToEnd)).map((g) => `${g.menuName}: ${g.text}`).join(' · ')}</div>
                      )}
                      {line.note && <div className="cart-line-sub" style={{ color: 'var(--warning)' }}>↳ {line.note}</div>}
                    </div>
                    <div className="cart-stepper">
                      <button className="cart-step" onClick={() => decOne(line.variantId, line.choiceKey)}>−</button>
                      <div className="cart-qty">{line.qty}</div>
                      <button className="cart-step" onClick={() => incLine(line.variantId, line.choiceKey)}>+</button>
                    </div>
                    <div className="cart-line-price">{euro(line.unitCents * line.qty)}</div>
                  </div>
                ))}
              </div>

              {/* Customer details (delivery) */}
              {isDelivery && (
                <div className="card" style={{ marginTop: 12 }}>
                  <h3 style={{ marginBottom: 10 }}>Jouw gegevens</h3>
                  <div className="col">
                    <input placeholder="Naam *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                    <div className="row" style={{ gap: 10 }}>
                      <input placeholder="Telefoonnummer *" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                      <input placeholder="Tafelnummer *" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} style={{ width: 118, flexShrink: 0 }} />
                    </div>
                    <input placeholder="E-mail (voor bevestiging)" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                    <textarea placeholder="Opmerkingen / allergieën" rows={2} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
                    <div className="col" style={{ gap: 6 }}>
                      <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Betaling</span>
                      <div className="seg">
                        <button type="button" className={`seg-opt ${payMethod === 'ON_DELIVERY' ? 'is-on' : ''}`} onClick={() => setPayMethod('ON_DELIVERY')}>Bij levering</button>
                        <button type="button" className={`seg-opt ${payMethod === 'ONLINE' ? 'is-on' : ''}`} disabled={onlineUnavailable} title={onlineUnavailable ? 'Online betalen is nu niet beschikbaar' : undefined} onClick={() => setPayMethod('ONLINE')}>Online betalen 💳</button>
                      </div>
                      {onlineUnavailable && <div className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>Online betalen is nu niet beschikbaar.</div>}
                      {payMethod === 'ON_DELIVERY' && <div className="muted" style={{ fontSize: 12 }}>Alleen cash aan de deur — geen kaart.</div>}
                    </div>
                  </div>
                </div>
              )}

              {isDelivery && underMin && (
                <div className="min-progress">
                  <div className="min-progress-row">
                    <span>Nog {euro(minCents - total)} tot het minimum</span>
                    <span>{euro(total)} / {euro(minCents)}</span>
                  </div>
                  <div className="min-bar"><div className="min-bar-fill" style={{ width: `${Math.min(100, Math.round((total / minCents) * 100))}%` }} /></div>
                </div>
              )}

              {!isDelivery && (
                <div className="eatin-note">Geen gegevens of betaling nodig —<br />dit gaat direct naar de keuken.</div>
              )}

              <div className="cart-bar">
                {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
                {isClosed ? (
                  <button className="cta-blocked" disabled>
                    <span>🌙 Gesloten{location.openFrom ? ` — open vanaf ${location.openFrom}` : ''}</span>
                    {openLabel && <span className="cta-sub">Bestellen kan elke dag van {openLabel}</span>}
                  </button>
                ) : pausedCartLines.length > 0 ? (
                  <button className="cta-blocked" disabled>
                    <span>⏸ {pausedCartLines[0].pz.screenName || 'Keuken'} gepauzeerd{pausedCartLines[0].pz.until ? ` tot ${pausedCartLines[0].pz.until}` : ''}</span>
                    <span className="cta-sub">Verwijder de gepauzeerde items om al te bestellen</span>
                  </button>
                ) : isDelivery && underMin ? (
                  <button className="cta-blocked" disabled>
                    <span>Nog {euro(minCents - total)} te gaan</span>
                    <span className="cta-sub">Minimum bestelbedrag {euro(minCents)}</span>
                  </button>
                ) : (
                  <button className="primary" disabled={submitting || (isDelivery && (!customerName.trim() || !customerPhone.trim() || !tableLabel.trim()))} onClick={submit} style={{ width: '100%', fontSize: 17, height: 54 }}>
                    {submitting ? 'Verzenden…' : isDelivery ? `Bestellen — ${euro(total)} (${itemCount})` : `Naar de keuken sturen — ${euro(total)}`}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ===== MENU VIEW ===== */}
      {view === 'MENU' && (
        <>
          <div className="order-menu-header" style={{ background: 'var(--primary)', color: '#fff' }}>
            {isDelivery && <div style={{ fontSize: 12, opacity: 0.85, letterSpacing: '0.04em' }}>LEVERING AAN TAFEL</div>}
            <h2 style={{ fontSize: 22, margin: 0, marginTop: isDelivery ? 2 : 0 }}>{headerTitle}</h2>
          </div>

          {isDelivery && (() => {
            // Delivery info (min order + ETA / note) lives in the yellow hint box
            // below the header — matches the redesign mockup.
            const parts: string[] = [];
            if (minCents > 0) parts.push(`Minimum bestelbedrag ${euro(minCents).replace(/[.,]00$/, '')}`);
            if (location.deliveryEtaMin) parts.push(`bezorging binnen ±${location.deliveryEtaMin} min.`);
            else if (location.deliveryNote) parts.push(location.deliveryNote);
            return parts.length ? <div className="min-order-hint">{parts.join(' — ')}</div> : null;
          })()}

          {/* Closed: outside opening hours nothing can be ordered */}
          {isClosed && (
            <div className="closed-banner">
              <span className="pause-banner-icon">🌙</span>
              <span>We zijn nu <strong>gesloten</strong>{openLabel ? <> — bestellen kan elke dag van <strong>{openLabel}</strong></> : null}. Je kan het menu wel al bekijken.</span>
            </div>
          )}

          {/* Rush pause: one banner per paused screen with items on this menu */}
          {!isClosed && pausedScreenBanners().map((b) => (
            <div key={b.name} className="pause-banner">
              <span className="pause-banner-icon">⏸</span>
              <span>
                {b.message || <>Onze <strong>{b.name.toLowerCase()}</strong> pauzeert even tijdens de drukte — deze gerechten kan je {b.until ? <>weer bestellen <strong>vanaf {b.until}</strong></> : 'straks weer bestellen'}. De rest van het menu blijft gewoon beschikbaar.</>}
              </span>
            </div>
          ))}

          {profilesData.length === 0 && <div className="card"><p className="muted">Het menu is momenteel niet beschikbaar.</p></div>}

          {profilesData.map((p) => {
            const pKey = `p-${p.id}`;
            const multiProfile = profilesData.length > 1;
            return (
              <div key={pKey}>
                {multiProfile && (
                  <div className="category">
                    <button onClick={() => toggle(pKey)}>{p.name} <span style={{ float: 'right' }}>{open[pKey] ? '▾' : '▸'}</span></button>
                    {open[pKey] && <div className="category-content" style={{ padding: 0 }}>{renderCats(p.categories, p.id)}</div>}
                  </div>
                )}
                {!multiProfile && renderCats(p.categories, null)}
              </div>
            );
          })}

          {/* Floating cart bar */}
          {cart.length > 0 && (
            <button className="floating-cart" onClick={() => setView('CART')}>
              <span className="fc-badge">🛒</span>
              <span className="fc-info"><span className="muted" style={{ color: 'rgba(255,255,255,0.85)' }}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span><strong style={{ fontSize: 17 }}>{euro(total)}</strong></span>
              <span className="fc-cta">Bekijk mandje →</span>
            </button>
          )}
        </>
      )}

      {noteTarget != null && (
        <div role="dialog" aria-modal="true" style={overlay}>
          <div className="card" style={{ maxWidth: 420, width: '92%' }}>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>Opmerking toevoegen</div>
            <textarea autoFocus rows={3} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="bv. zonder ui" style={{ width: '100%' }} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => { setNoteTarget(null); setNoteDraft(''); }}>Annuleren</button>
              <button className="primary" onClick={() => { if (noteTarget) { setCart((list) => list.map((x) => (x.variantId === noteTarget.vId && (x.choiceKey || '') === (noteTarget.key || '')) ? { ...x, note: noteDraft.trim() || undefined } : x)); } setNoteTarget(null); setNoteDraft(''); }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {choiceFlow && (() => {
        const menus = choiceFlow.menus;
        const stepCount = menus.length;
        const stepIdx = choiceFlow.idx;
        const menu = menus[stepIdx];
        const opts: any[] = menu.options || [];
        const isLast = stepIdx >= stepCount - 1;
        const multi = stepCount > 1;
        const isMulti = !!menu.allowMultiple;
        const pendSingle = choiceFlow.pendingSingle;
        const pendMulti: string[] = choiceFlow.pendingMulti || [];
        const variantLabel = choiceFlow.variant.name && choiceFlow.variant.name.trim() ? ` — ${choiceFlow.variant.name}` : '';
        const committedAdd = (choiceFlow.stepSel || []).flat().reduce((s: number, c: any) => s + (c.priceCents || 0), 0);
        const pendingAdd = isMulti
          ? opts.filter((o: any) => pendMulti.includes(String(o.name))).reduce((s: number, o: any) => s + Number(o.priceCents || 0), 0)
          : (() => { const o = opts.find((x: any) => String(x.name) === pendSingle); return o ? Number(o.priceCents || 0) : 0; })();
        const runningTotal = choiceFlow.variant.priceCents + committedAdd + pendingAdd;
        const canNext = !menu.requireOne || (isMulti ? pendMulti.length > 0 : (!!pendSingle && pendSingle !== '(none)'));
        return (
          <div className="sheet-backdrop" onClick={cancelChoice}>
            <div className="bottom-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="sheet-head">
                {stepIdx > 0 && <button className="sheet-back" onClick={stepBack} aria-label="Terug">‹</button>}
                <div className="sheet-title" style={{ flex: 1 }}>{choiceFlow.product.name}{variantLabel}</div>
                {multi && <div className="sheet-step">Stap {stepIdx + 1} / {stepCount}</div>}
              </div>
              {multi ? (
                <div className="sheet-progress">
                  {menus.map((_: any, i: number) => <div key={i} className={`seg-bar ${i <= stepIdx ? 'on' : ''}`} />)}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 13, marginTop: 2, marginBottom: 16 }}>{euro(choiceFlow.variant.priceCents)}</div>
              )}
              <div className="sheet-section">
                {menu.name} {menu.requireOne && <span style={{ color: 'var(--danger)' }}>*</span>}{' '}
                <span className="muted" style={{ fontWeight: 500 }}>· {isMulti ? 'meerdere mogelijk' : (menu.requireOne ? 'kies 1' : 'optioneel')}</span>
              </div>
              <div className="col" style={{ gap: 9 }}>
                {isMulti ? (
                  opts.map((o: any) => {
                    const checked = pendMulti.includes(String(o.name));
                    return (
                      <label key={o.id} className={`sheet-option ${checked ? 'sel' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMulti(String(o.name))} />
                        <span className="opt-check" aria-hidden="true" />
                        <span style={{ flex: 1 }}>{o.name}</span>
                        <span className="muted">{o.priceCents ? `+${euro(o.priceCents)}` : ''}</span>
                      </label>
                    );
                  })
                ) : (
                  <>
                    {!menu.requireOne && (
                      <label className={`sheet-option ${(!pendSingle || pendSingle === '(none)') ? 'sel' : ''}`}>
                        <input type="radio" name={`m-${menu.name}`} checked={!pendSingle || pendSingle === '(none)'} onChange={() => setChoiceFlow((f: any) => f ? { ...f, pendingSingle: '(none)' } : f)} />
                        <span className="opt-radio" aria-hidden="true" />
                        <span style={{ flex: 1, color: 'var(--muted)' }}>Geen</span>
                      </label>
                    )}
                    {opts.map((o: any) => (
                      <label key={o.id} className={`sheet-option ${pendSingle === String(o.name) ? 'sel' : ''}`}>
                        <input type="radio" name={`m-${menu.name}`} checked={pendSingle === String(o.name)} onChange={() => setChoiceFlow((f: any) => f ? { ...f, pendingSingle: String(o.name) } : f)} />
                        <span className="opt-radio" aria-hidden="true" />
                        <span style={{ flex: 1 }}>{o.name}</span>
                        <span className="muted">{o.priceCents ? `+${euro(o.priceCents)}` : ''}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              <div className="sheet-footer">
                {multi
                  ? <div className="sheet-total">Totaal nu<br /><strong>{euro(runningTotal)}</strong></div>
                  : <button className="ghost-btn" onClick={cancelChoice}>Annuleren</button>}
                <button className="primary sheet-cta" disabled={!canNext} onClick={confirmChoice}>
                  {isLast ? `Toevoegen — ${euro(runningTotal)}` : 'Volgende →'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  function toggle(id: string) { setOpen((o) => ({ ...o, [id]: !o[id] })); }

  // A product renders as a big photo card only when the uitbater turned on
  // "Groot" AND a photo exists. Multi-variant products always use the row form.
  function isBigCard(prod: any) {
    const hasVariants = prod.variants.length > 1 || prod.variants.some((v: any) => v.name && v.name.trim());
    return !hasVariants && !!prod.largeCard && !!prod.imageUrl;
  }

  // ----- Rush pause -----------------------------------------------------------
  // Effective screen for the pause check: product override → category default →
  // location default. (Per-table route overrides are ignored here; the server
  // re-checks with them applied at order time.) Live socket state wins over the
  // screen row embedded in the tree at load time.
  function effectiveScreen(prod: any, cat: any) {
    const base = prod?.prepScreen ?? cat?.prepScreen ?? location?.prepScreen ?? null;
    if (!base) return null;
    return { ...base, ...(screenStatus[base.id] || {}) };
  }
  function pauseFor(prod: any, cat: any) {
    return screenPauseState(effectiveScreen(prod, cat));
  }
  // Same, but starting from a cart line's variantId (scan the loaded menu).
  function pauseForVariant(variantId: number) {
    for (const p of profilesData) {
      for (const cat of p.categories || []) {
        for (const prod of cat.products || []) {
          if ((prod.variants || []).some((v: any) => v.id === variantId)) {
            const scr = effectiveScreen(prod, cat);
            return { ...screenPauseState(scr), screenName: scr?.name as string | undefined };
          }
        }
      }
    }
    return { paused: false, until: null, screenName: undefined };
  }
  // One banner per paused screen that actually affects items on this menu.
  function pausedScreenBanners() {
    const seen = new Map<number, { name: string; message: string | null; until: string | null }>();
    profilesData.forEach((p) => (p.categories || []).forEach((cat: any) => (cat.products || []).forEach((prod: any) => {
      const scr = effectiveScreen(prod, cat);
      if (!scr || seen.has(scr.id)) return;
      const st = screenPauseState(scr);
      if (st.paused) seen.set(scr.id, { name: scr.name, message: scr.pauseMessage || null, until: st.until });
    })));
    return [...seen.values()];
  }

  function renderCats(cats: any[], pid: number | null) {
    return cats.map((cat: any) => {
      const cKey = pid != null && profilesData.length > 1 ? `p${pid}-c${cat.id}` : String(cat.id);
      const cOpen = open[cKey];
      // Big photo cards float to the top of the category; the rest sit below a
      // "Verder in de kaart" divider (only shown when both groups exist).
      const bigs = (cat.products || []).filter(isBigCard);
      const smalls = (cat.products || []).filter((p: any) => !isBigCard(p));
      return (
        <div key={cat.id} className="category">
          <button onClick={() => toggle(cKey)}>{cat.name} <span style={{ float: 'right' }}>{cOpen ? '▾' : '▸'}</span></button>
          {cOpen && (
            <div className="category-content">
              {bigs.map((prod: any) => renderProduct(prod, cat))}
              {bigs.length > 0 && smalls.length > 0 && <div className="menu-divider">Verder in de kaart</div>}
              {smalls.map((prod: any) => renderProduct(prod, cat))}
            </div>
          )}
        </div>
      );
    });
  }

  // Declared as a hoisted function (not a const) because it's referenced inside
  // renderProduct, which runs while the component body's `return` is still
  // evaluating — before a `const` defined here would be initialized (TDZ).
  function openNote(v: number, k?: string) { setNoteTarget({ vId: v, key: k }); setNoteDraft(''); }

  function renderProduct(prod: any, cat: any) {
    const hasVariants = prod.variants.length > 1 || prod.variants.some((v: any) => v.name && v.name.trim());
    const img = prod.imageUrl ? api.assetUrl(prod.imageUrl) : '';
    const recommended = !!prod.recommended;
    // Rush pause: the screen this product routes to isn't taking orders now.
    // (Irrelevant while the whole location is closed — closed wins.)
    const pz = isClosed ? { paused: false, until: null } : pauseFor(prod, cat);
    const paused = pz.paused;
    const pauseLabel = pz.until ? `tot ${pz.until}` : 'even pauze';

    // ----- BIG PHOTO CARD: "Groot" + photo (single item) -----
    if (isBigCard(prod)) {
      const v0 = prod.variants[0];
      const so = !!v0.soldOut;
      const off = so || paused || isClosed;
      const lines = cart.filter((i) => i.variantId === v0.id);
      const desc = [prod.description, euro(v0.priceCents)].filter(Boolean).join(' · ');
      return (
        <div key={prod.id} className="product-card photo-card-wrap">
          <div className={`photo-card ${so ? 'sold' : ''} ${paused ? 'paused' : ''}`} style={{ backgroundImage: `url(${img})` }}>
            {recommended && <span className="pc-badge">★ Aanrader</span>}
            {so ? <span className="pc-sold">Uitverkocht</span> : paused && <span className="pc-pause">⏸ {pauseLabel}</span>}
            <div className="pc-overlay">
              <div className="pc-info">
                <div className="pc-name">{prod.name}</div>
                <div className="pc-desc">{desc}</div>
              </div>
              <button className="pc-add" disabled={off} onClick={() => { if (!off) add(v0, prod); }}>+</button>
            </div>
          </div>
          {lines.length > 0 && <Lines lines={lines} inc={incLine} dec={decOne} onNote={openNote} />}
        </div>
      );
    }

    // ----- THUMBNAIL ROW: "Klein" + photo (single item) -----
    if (!hasVariants && img) {
      const v0 = prod.variants[0];
      const so = !!v0.soldOut;
      const off = so || paused || isClosed;
      const lines = cart.filter((i) => i.variantId === v0.id);
      return (
        <div key={prod.id} className="product-card">
          <div className={`thumb-row ${so ? 'sold' : ''} ${paused ? 'paused' : ''}`}>
            <div className="thumb" style={{ backgroundImage: `url(${img})` }} />
            <div className="thumb-info">
              <div className="product-name" style={off ? { color: '#9aa0a8' } : undefined}>
                {recommended && <span className="rec-star" title="Aanrader">★</span>}{prod.name}
              </div>
              {so
                ? <div style={{ marginTop: 2 }}><span className="sold-badge sm">Uitverkocht</span></div>
                : paused
                  ? <div style={{ marginTop: 2 }}><span className="pause-badge">⏸ {pauseLabel}</span></div>
                  : prod.description && <div className="muted thumb-desc">{prod.description}</div>}
            </div>
            <div className={`price-pill ${so ? 'struck' : ''}`}>{euro(v0.priceCents)}</div>
            <button className="primary add-btn small" disabled={off} onClick={() => { if (!off) add(v0, prod); }}>+</button>
          </div>
          {lines.length > 0 && <Lines lines={lines} inc={incLine} dec={decOne} onNote={openNote} />}
        </div>
      );
    }

    // ----- TEXT ROW / MULTI-VARIANT (no photo, or "Klein" without one) -----
    const lines = cart.filter((i) => prod.variants.some((v: any) => v.id === i.variantId));
    return (
      <div key={prod.id} className="product-card">
        {!hasVariants ? (
          <>
            {(() => {
              const v0 = prod.variants[0];
              const so = !!v0.soldOut;
              const off = so || paused || isClosed;
              return (
                <div className={`single-row triple ${so ? 'sold' : ''} ${paused ? 'paused' : ''}`}>
                  <div>
                    <div className="product-name" style={off ? { color: '#9aa0a8' } : undefined}>
                      {recommended && <span className="rec-star" title="Aanrader">★</span>}{prod.name}
                    </div>
                    {so ? (
                      <div style={{ marginTop: 4 }}><span className="sold-badge">Uitverkocht</span></div>
                    ) : paused ? (
                      <div style={{ marginTop: 4 }}><span className="pause-badge">⏸ {pauseLabel}</span></div>
                    ) : (
                      <>
                        {prod.description && <div className="muted" style={{ fontSize: 12 }}>{prod.description}</div>}
                        {prod.allergens && <div className="muted" style={{ fontSize: 11 }}>Allergenen: {prod.allergens}</div>}
                      </>
                    )}
                  </div>
                  <div className={`price-pill ${so ? 'struck' : ''}`}>{euro(v0.priceCents)}</div>
                  <button className="primary add-btn small" disabled={off} onClick={() => { if (!off) add(v0, prod); }}>+</button>
                </div>
              );
            })()}
            {lines.length > 0 && <Lines lines={lines} inc={incLine} dec={decOne} onNote={openNote} />}
          </>
        ) : (
          <>
            <div className="product-name" style={{ marginBottom: 4 }}>
              {recommended && <span className="rec-star" title="Aanrader">★</span>}{prod.name}
              {paused && <span className="pause-badge" style={{ marginLeft: 7 }}>⏸ {pauseLabel}</span>}
            </div>
            {prod.description && <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{prod.description}</div>}
            <div className="variant-group">
              {prod.variants.map((v: any) => {
                const vLines = cart.filter((l) => l.variantId === v.id);
                const so = !!v.soldOut;
                const off = so || paused || isClosed;
                return (
                  <div key={v.id}>
                    <div className={`variant-row multi ${so ? 'sold' : ''} ${paused ? 'paused' : ''}`}>
                      <div style={off ? { display: 'flex', alignItems: 'center', gap: 7, color: '#9aa0a8' } : undefined}>{v.name}{so && <span className="sold-badge sm">Uitverkocht</span>}</div>
                      <div className={`price-pill ${so ? 'struck' : ''}`}>{euro(v.priceCents)}</div>
                      <button className="primary add-btn small" disabled={off} onClick={() => { if (!off) add(v, prod); }}>+</button>
                    </div>
                    {vLines.length > 0 && <Lines lines={vLines} inc={incLine} dec={decOne} onNote={openNote} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }
}

function Lines({ lines, inc, dec, onNote }: { lines: any[]; inc: (v: number, k?: string) => void; dec: (v: number, k?: string) => void; onNote: (v: number, k?: string) => void }) {
  return (
    <div className="menu-cart-lines">
      {lines.map((line) => {
        const choices = groupChoices((line.choices || []).filter((c: any) => !c.appendToEnd));
        return (
          <div key={(line.choiceKey || '') + ':' + line.variantId} className="menu-cart-line">
            <div className="mcl-top">
              <div className="mcl-info">
                <div className="mcl-name">{line.name}</div>
                {choices.length > 0 && <div className="mcl-choices">{choices.map((g) => `${g.menuName}: ${g.text}`).join(' · ')}</div>}
                {line.note && <div className="mcl-note">↳ {line.note}</div>}
              </div>
              <div className="mcl-price">{euro(line.unitCents * line.qty)}</div>
            </div>
            <div className="mcl-actions">
              <button className="step-btn" onClick={() => dec(line.variantId, line.choiceKey)}>−</button>
              <div className="mcl-qty">{line.qty}</div>
              <button className="step-btn" onClick={() => inc(line.variantId, line.choiceKey)}>+</button>
              <div className="mcl-spacer" />
              <button className="step-btn ghost" onClick={() => onNote(line.variantId, line.choiceKey)} title="Opmerking">💬</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Group a line's choices by menu so multi-select picks read as
// "Extra's: Extra saus, Bicky uitjes" instead of repeating the menu name.
function groupChoices(choices: any[], withPrice = false): { menuName: string; text: string }[] {
  const order: string[] = [];
  const byMenu = new Map<string, string[]>();
  for (const c of choices) {
    let label = c.optionName || 'geen';
    if (withPrice && c.priceCents) label += ` (+${euro(c.priceCents)})`;
    if (!byMenu.has(c.menuName)) { byMenu.set(c.menuName, []); order.push(c.menuName); }
    byMenu.get(c.menuName)!.push(label);
  }
  return order.map((m) => ({ menuName: m, text: byMenu.get(m)!.join(', ') }));
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 };
