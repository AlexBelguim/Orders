import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { euro, euroToCents } from '../lib/format';

export default function ProductsAdmin({ profiles, screens, onChange }: { profiles: any[]; screens: any[]; onChange: () => void }) {
  const [profileId, setProfileId] = useState<number | null>(profiles[0]?.id ?? null);
  const [tree, setTree] = useState<any>(null);
  const [menus, setMenus] = useState<any[]>([]);
  const [newCat, setNewCat] = useState('');

  useEffect(() => { if (profiles.length && profileId == null) setProfileId(profiles[0].id); }, [profiles]);
  useEffect(() => { api.getChoiceMenus().then(setMenus).catch(() => {}); }, [onChange]);

  const load = async () => {
    if (profileId == null) return;
    const t = await api.getProductTree(profileId);
    setTree(t);
  };
  useEffect(() => { load(); }, [profileId, onChange]);

  const reloadMenus = () => api.getChoiceMenus().then(setMenus);

  const addCategory = async () => {
    const name = newCat.trim(); if (!name || profileId == null) return;
    await api.createCategory(name, profileId);
    setNewCat(''); load();
  };

  const renameCat = async (id: number, name: string) => { await api.updateCategory(id, { name }); load(); };
  const setCatScreen = async (id: number, prepScreenId: string | number | null) => {
    await api.updateCategory(id, { prepScreenId: prepScreenId === '' ? null : Number(prepScreenId) }); load();
  };
  const delCat = async (id: number) => { if (confirm('Categorie verbergen?')) { await api.deleteCategory(id); load(); } };

  const renameProd = async (id: number, name: string) => { await api.updateProduct(id, { name }); load(); };
  const setProdField = async (id: number, field: string, value: any) => { await api.updateProduct(id, { [field]: value || null }); load(); };
  const setProdScreen = async (id: number, prepScreenId: string) => { await api.updateProduct(id, { prepScreenId: prepScreenId === '' ? null : Number(prepScreenId) }); load(); };
  const delProd = async (id: number) => { if (confirm('Product verbergen?')) { await api.deleteProduct(id); load(); } };

  const setPrice = async (p: any) => {
    const single = p.variants.length === 1 && (!p.variants[0].name || !p.variants[0].name.trim());
    if (!single) { alert('Dit product heeft meerdere varianten. Gebruik "Variant" onder het product.'); return; }
    const cur = single ? (p.variants[0].priceCents / 100).toFixed(2) : '0.00';
    const input = prompt('Prijs (€)', cur); if (input == null) return;
    const cents = euroToCents(input); if (Number.isNaN(cents)) { alert('Ongeldige prijs'); return; }
    await api.updateVariant(p.variants[0].id, { priceCents: cents }); load();
  };

  const addVariant = async (p: any) => {
    const name = prompt('Variant naam'); if (!name) return;
    const input = prompt('Prijs (€)', '0.00'); if (input == null) return;
    const cents = euroToCents(input); if (Number.isNaN(cents)) { alert('Ongeldige prijs'); return; }
    await api.createVariant(p.id, name, cents); load();
  };

  // Drag & drop product between/within categories.
  const [drag, setDrag] = useState<{ productId: number; fromCategoryId: number } | null>(null);
  const onDropToCategory = async (toCategoryId: number, toIndex: number) => {
    if (!drag) return;
    await api.moveProduct(drag.productId, toCategoryId, toIndex);
    setDrag(null); load();
  };

  const attachMenu = async (productId: number, menuId: number) => { await api.attachMenuToProduct(productId, menuId); load(); };
  const detachMenu = async (productId: number, menuId: number) => { await api.detachMenuFromProduct(productId, menuId); };
  const reorderMenus = async (productId: number, ids: number[]) => { await api.reorderProductMenus(productId, ids); load(); };

  return (
    <div className="col">
      <div className="section-card">
        <div className="admin-toolbar">
          <div className="row">
            <label className="muted">Menu/profiel:</label>
            <select value={profileId ?? ''} onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : null)}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <NewProfileInline onChange={onChange} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="grow" placeholder="Nieuwe categorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
          <button className="primary" onClick={addCategory}>Categorie toevoegen</button>
        </div>
      </div>

      {!tree && <div className="muted">Laden…</div>}
      {tree && tree.categories.length === 0 && <div className="card muted">Nog geen categorieën. Voeg er hierboven één toe.</div>}

      <div className="products-grid">
        {(tree?.categories || []).map((cat: any) => (
          <div key={cat.id} className="section-card" style={{ marginBottom: 0 }}>
            <div className="cat-head">
              <input className="grow" defaultValue={cat.name} onBlur={(e) => renameCat(cat.id, e.target.value)} />
              <select className="cat-screen-sel" value={cat.prepScreenId ?? ''} onChange={(e) => setCatScreen(cat.id, e.target.value)} title="Standaard bereidingsscherm">
                <option value="">— scherm —</option>
                {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="danger cat-del" onClick={() => delCat(cat.id)}>✕</button>
            </div>

            <AddProductInline categoryId={cat.id} screens={screens} afterSave={load} />

            <ul className="prod-list">
              {cat.products.map((p: any, idx: number) => (
                <li
                  key={p.id}
                  draggable
                  onDragStart={() => setDrag({ productId: p.id, fromCategoryId: cat.id })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropToCategory(cat.id, idx)}
                  className="prod-item"
                >
                  <span className="drag-handle" title="Slepen">⋮⋮</span>
                  <div className="prod-body">
                    {/* Row 1: name + action buttons (wrap). For single-price products
                        the sold-out toggle sits here as a proper button. */}
                    <div className={`prod-main ${p.variants.length === 1 && (!p.variants[0].name || !p.variants[0].name.trim()) && p.variants[0].soldOut ? 'is-sold' : ''}`}>
                      <input defaultValue={p.name} onBlur={(e) => renameProd(p.id, e.target.value)} />
                      <div className="btn-group">
                        <button className="btn-secondary" onClick={() => setPrice(p)}>Prijs</button>
                        <button className="btn-secondary" onClick={() => addVariant(p)}>+ Variant</button>
                        {p.variants.length === 1 && (!p.variants[0].name || !p.variants[0].name.trim()) && (
                          <button
                            className={`btn-soldout btn-icon${p.variants[0].soldOut ? ' active' : ''}`}
                            title={p.variants[0].soldOut ? 'Uitverkocht — klik om weer beschikbaar te maken' : 'Markeer als uitverkocht'}
                            onClick={() => api.updateVariant(p.variants[0].id, { soldOut: !p.variants[0].soldOut }).then(load)}
                          >
                            ⚠️
                          </button>
                        )}
                        <button className="danger btn-icon" onClick={() => delProd(p.id)}>✕</button>
                      </div>
                    </div>
                    {/* Row 1b: per-item display controls (order page variant D) */}
                    <ProductDisplayControls product={p} onChange={load} />

                    {/* Row 2: meta (price summary) */}
                    <div className="prod-meta muted">{p.variants.map((v: any) => (v.name ? `${v.name} ` : '') + euro(v.priceCents)).join('  •  ')}</div>
                    {/* Row 3: details (description | allergens | screen) */}
                    <div className="prod-details">
                      <input className="field" placeholder="Omschrijving" defaultValue={p.description || ''} onBlur={(e) => setProdField(p.id, 'description', e.target.value)} />
                      <input className="field" placeholder="Allergenen" defaultValue={p.allergens || ''} onBlur={(e) => setProdField(p.id, 'allergens', e.target.value)} />
                      <select value={p.prepScreenId ?? ''} onChange={(e) => setProdScreen(p.id, e.target.value)} title="Scherm override (anders categorie)">
                        <option value="">scherm: cat</option>
                        {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>

                    {/* Variants editor — shown for multi-variant products.
                        Each variant keeps its inline sold-out checkbox. */}
                    {p.variants.length > 1 && (
                      <div className="variant-list">
                        {p.variants.map((v: any) => (
                          <div key={v.id} className={`variant-line ${v.soldOut ? 'sold' : ''}`}>
                            <input className="v-name" defaultValue={v.name} onBlur={(e) => api.updateVariant(v.id, { name: e.target.value })} />
                            <input className="v-price" defaultValue={(v.priceCents / 100).toFixed(2)} onBlur={(e) => { const c = euroToCents(e.target.value); if (!Number.isNaN(c)) api.updateVariant(v.id, { priceCents: c }); }} />
                            <button
                              className={`v-soldout${v.soldOut ? ' active' : ''}`}
                              title={v.soldOut ? 'Uitverkocht — klik om weer beschikbaar te maken' : 'Markeer als uitverkocht'}
                              onClick={() => api.updateVariant(v.id, { soldOut: !v.soldOut }).then(load)}
                            >
                              ⚠️
                            </button>
                            <button className="danger v-del" onClick={() => { if (confirm('Variant verwijderen?')) { api.deleteVariant(v.id).then(load); } }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Choice menus */}
                    <ProductMenusEditor productId={p.id} productMenus={p.productMenus || []} menus={menus} onAttach={attachMenu} onDetach={detachMenu} onReorder={reorderMenus} />
                  </div>
                </li>
              ))}
              <li className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={() => onDropToCategory(cat.id, cat.products.length)}>↧ Hier neerzetten</li>
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-item display controls shown under each product (order page variant D):
//  • photo upload / replace / remove
//  • "Weergave": Groot (big photo card) vs Klein (row) — Groot needs a photo
//  • "Aanrader": ★ badge, independent of size
function ProductDisplayControls({ product, onChange }: { product: any; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const img: string | null = product.imageUrl || null;
  const recommended = !!product.recommended;
  // Groot only has any effect with a photo, so reflect that in the UI.
  const effectiveLarge = !!product.largeCard && !!img;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Afbeelding te groot (max 5MB).'); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      await api.uploadProductImage(product.id, dataUrl);
      onChange();
    } catch (e: any) { alert(e?.message || 'Upload mislukt'); }
    finally { setBusy(false); }
  };

  const removeImg = async () => { if (confirm('Foto verwijderen?')) { await api.deleteProductImage(product.id); onChange(); } };
  const setLarge = async (v: boolean) => { if (v === effectiveLarge) return; await api.updateProduct(product.id, { largeCard: v }); onChange(); };
  const toggleRec = async () => { await api.updateProduct(product.id, { recommended: !recommended }); onChange(); };

  return (
    <div className="prod-display">
      <label className={`prod-photo ${img ? 'has' : ''}`} title={img ? 'Foto vervangen' : 'Foto uploaden'}>
        {img ? <img src={api.assetUrl(img)} alt="" /> : <span className="prod-photo-empty">{busy ? '…' : '＋ foto'}</span>}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={busy}
          onChange={(e) => { pickFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
      </label>
      {img && <button className="photo-del" onClick={removeImg} title="Foto verwijderen">✕</button>}

      <div className="weergave">
        <span className="weergave-label">Weergave</span>
        <div className="seg-toggle">
          <button type="button" className={effectiveLarge ? 'on' : ''} onClick={() => setLarge(true)} disabled={!img} title={img ? '' : 'Upload eerst een foto'}>Groot</button>
          <button type="button" className={!effectiveLarge ? 'on' : ''} onClick={() => setLarge(false)}>Klein</button>
        </div>
      </div>

      <button type="button" className={`aanrader ${recommended ? 'on' : ''}`} onClick={toggleRec}>★ Aanrader</button>

      {!img && <div className="prod-photo-hint">Geen foto → toont als tekstrij.</div>}
    </div>
  );
}

function NewProfileInline({ onChange }: { onChange: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="row">
      <input className="field-narrow" placeholder="Nieuw menu" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={async () => { if (!name.trim()) return; await api.createProfile(name.trim()); setName(''); onChange(); }}>+</button>
    </div>
  );
}

function AddProductInline({ categoryId, screens, afterSave }: { categoryId: number; screens: any[]; afterSave: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [screenId, setScreenId] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    const cents = euroToCents(price || '0');
    await api.createProduct({
      name: name.trim(),
      categoryId,
      description: desc.trim() || undefined,
      prepScreenId: screenId ? Number(screenId) : undefined,
      variants: [{ name: '', priceCents: Number.isNaN(cents) ? 0 : cents }],
    });
    setName(''); setPrice(''); setDesc(''); setScreenId('');
    afterSave();
  };

  return (
    <div className="add-prod-grid">
      <input placeholder="Productnaam" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="v-price" placeholder="€" value={price} onChange={(e) => setPrice(e.target.value)} />
      <select value={screenId} onChange={(e) => setScreenId(e.target.value)}>
        <option value="">scherm: cat</option>
        {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button className="primary" onClick={save}>Toevoegen</button>
    </div>
  );
}

function ProductMenusEditor({ productId, productMenus, menus, onAttach, onDetach, onReorder }: {
  productId: number; productMenus: any[]; menus: any[];
  onAttach: (pid: number, mid: number) => void;
  onDetach: (pid: number, mid: number) => void;
  onReorder: (pid: number, ids: number[]) => void;
}) {
  const sorted = [...productMenus].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const [sel, setSel] = useState('');
  return (
    <div className="menus-box">
      <strong className="menus-title">Keuzemenu's</strong>
      <ul className="menu-list">
        {sorted.map((pm: any, i: number) => {
          const mid = pm.menuId || pm.menu?.id;
          return (
            <li key={mid} className="menu-line">
              <span>{pm.menu?.name || pm.menuName}</span>
              <button disabled={i === 0} onClick={() => { const ids = sorted.map((x) => x.menuId || x.menu?.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; onReorder(productId, ids); }}>↑</button>
              <button disabled={i === sorted.length - 1} onClick={() => { const ids = sorted.map((x) => x.menuId || x.menu?.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; onReorder(productId, ids); }}>↓</button>
              <button className="danger" onClick={() => onDetach(productId, mid)}>✕</button>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="muted menus-empty">Geen</li>}
      </ul>
      <div className="menu-attach">
        <select className="grow" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Menu koppelen…</option>
          {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button onClick={() => { if (sel) { onAttach(productId, Number(sel)); setSel(''); } }}>Koppelen</button>
      </div>
    </div>
  );
}
