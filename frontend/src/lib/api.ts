const API = import.meta.env.VITE_API_URL || '';

// Resolve a stored image path (e.g. "/uploads/prod-3-….jpg") to a loadable URL.
// Absolute URLs (http…) pass through; server-relative paths get the API host.
export const assetUrl = (p?: string | null) => (!p ? '' : /^https?:\/\//i.test(p) ? p : `${API}${p}`);

// Tiny fetch helpers ----------------------------------------------------------
async function jfetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
const json = (body: any) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const jsonPut = (body: any) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (body: any) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Settings --------------------------------------------------------------------
export const verifyCode = (code: string) => jfetch(`${API}/api/settings/verify-code`, json({ code }));
export const getSettings = (keys?: string[]) => jfetch(`${API}/api/settings${keys ? `?keys=${keys.join(',')}` : ''}`);
export const putSetting = (key: string, value: string) => jfetch(`${API}/api/settings/${key}`, jsonPut({ value }));
export const putSettings = (obj: Record<string, string>) => jfetch(`${API}/api/settings`, jsonPut(obj));
export const testEmail = () => jfetch(`${API}/api/settings/test-email`, json({}));
export const getSoldOut = () => jfetch(`${API}/api/settings/sold-out`);
export const putSoldOut = (variantIds: number[]) => jfetch(`${API}/api/settings/sold-out`, jsonPut({ variantIds }));
export const clearOrders = () => jfetch(`${API}/api/settings/clear-orders`, json({ confirm: 'DELETE-ALL-ORDERS' }));

// QR --------------------------------------------------------------------------
export const qrLocationUrl = (code: string) => `${API}/api/qr/location/${code}.png`;
export const qrTableUrl = (code: string) => `${API}/api/qr/table/${code}.png`;
export const getQrBaseUrl = () => jfetch(`${API}/api/qr/base-url`);
export const putQrBaseUrl = (url: string) => jfetch(`${API}/api/qr/base-url`, jsonPut({ url }));

// Profiles --------------------------------------------------------------------
export const getProfiles = () => jfetch(`${API}/api/profiles`);
export const createProfile = (name: string) => jfetch(`${API}/api/profiles`, json({ name }));
export const updateProfile = (id: number, name: string) => jfetch(`${API}/api/profiles/${id}`, patch({ name }));
export const deleteProfile = (id: number) => jfetch(`${API}/api/profiles/${id}`, { method: 'DELETE' });

// Prep screens ----------------------------------------------------------------
export const getPrepScreens = () => jfetch(`${API}/api/prep-screens`);
export const createPrepScreen = (name: string, isTakeaway = false) => jfetch(`${API}/api/prep-screens`, json({ name, isTakeaway }));
export const updatePrepScreen = (id: number, data: any) => jfetch(`${API}/api/prep-screens/${id}`, patch(data));
export const deletePrepScreen = (id: number) => jfetch(`${API}/api/prep-screens/${id}`, { method: 'DELETE' });

// Products --------------------------------------------------------------------
export const getProductTree = (profileId?: number) => jfetch(`${API}/api/products/tree${profileId ? `?profileId=${profileId}` : ''}`);
export const createCategory = (name: string, profileId: number, prepScreenId?: number | null) => jfetch(`${API}/api/products/categories`, json({ name, profileId, prepScreenId: prepScreenId ?? null }));
export const updateCategory = (id: number, data: any) => jfetch(`${API}/api/products/categories/${id}`, patch(data));
export const deleteCategory = (id: number) => jfetch(`${API}/api/products/categories/${id}`, { method: 'DELETE' });
export const reorderCategories = (ids: number[]) => jfetch(`${API}/api/products/categories/reorder`, json({ ids }));
export const createProduct = (data: any) => jfetch(`${API}/api/products`, json(data));
export const updateProduct = (id: number, data: any) => jfetch(`${API}/api/products/${id}`, patch(data));
export const moveProduct = (id: number, toCategoryId: number | null, toIndex: number) => jfetch(`${API}/api/products/${id}/move`, json({ toCategoryId, toIndex }));
export const deleteProduct = (id: number) => jfetch(`${API}/api/products/${id}`, { method: 'DELETE' });
export const uploadProductImage = (id: number, dataUrl: string) => jfetch(`${API}/api/products/${id}/image`, json({ dataUrl }));
export const deleteProductImage = (id: number) => jfetch(`${API}/api/products/${id}/image`, { method: 'DELETE' });
export const createVariant = (productId: number, name: string, priceCents: number) => jfetch(`${API}/api/products/${productId}/variants`, json({ name, priceCents }));
export const updateVariant = (id: number, data: any) => jfetch(`${API}/api/products/variants/${id}`, patch(data));
export const deleteVariant = (id: number) => jfetch(`${API}/api/products/variants/${id}`, { method: 'DELETE' });

// Choices ---------------------------------------------------------------------
export const getChoiceMenus = () => jfetch(`${API}/api/choices/menus`);
export const createChoiceMenu = (name: string) => jfetch(`${API}/api/choices/menus`, json({ name }));
export const updateChoiceMenu = (id: number, data: any) => jfetch(`${API}/api/choices/menus/${id}`, patch(data));
export const deleteChoiceMenu = (id: number) => jfetch(`${API}/api/choices/menus/${id}`, { method: 'DELETE' });
export const addChoiceOption = (menuId: number, name: string, priceCents: number) => jfetch(`${API}/api/choices/menus/${menuId}/options`, json({ name, priceCents }));
export const updateChoiceOption = (id: number, data: any) => jfetch(`${API}/api/choices/options/${id}`, patch(data));
export const deleteChoiceOption = (id: number) => jfetch(`${API}/api/choices/options/${id}`, { method: 'DELETE' });
export const reorderChoiceOptions = (menuId: number, idsInOrder: number[]) => jfetch(`${API}/api/choices/menus/${menuId}/options/reorder`, json({ idsInOrder }));
export const attachMenuToProduct = (productId: number, menuId: number) => jfetch(`${API}/api/choices/attach`, json({ productId, menuId }));
export const detachMenuFromProduct = (productId: number, menuId: number) => jfetch(`${API}/api/choices/detach`, json({ productId, menuId }));
export const reorderProductMenus = (productId: number, menuIdsInOrder: number[]) => jfetch(`${API}/api/choices/reorder`, json({ productId, menuIdsInOrder }));

// Locations -------------------------------------------------------------------
export const getLocations = () => jfetch(`${API}/api/locations`);
export const getLocationByCode = (code: string) => jfetch(`${API}/api/locations/code/${code}`);
export const createLocation = (data: any) => jfetch(`${API}/api/locations`, json(data));
export const updateLocation = (id: number, data: any) => jfetch(`${API}/api/locations/${id}`, patch(data));
export const deleteLocation = (id: number) => jfetch(`${API}/api/locations/${id}`, { method: 'DELETE' });
export const setLocationAllowedProfiles = (id: number, profileIds: number[]) => jfetch(`${API}/api/locations/${id}/allowed-profiles`, jsonPut({ profileIds }));
export const toggleExcludeCategory = (id: number, catId: number, on: boolean) =>
  jfetch(`${API}/api/locations/${id}/exclude-category/${catId}`, { method: on ? 'POST' : 'DELETE' });
export const toggleExcludeProduct = (id: number, prodId: number, on: boolean) =>
  jfetch(`${API}/api/locations/${id}/exclude-product/${prodId}`, { method: on ? 'POST' : 'DELETE' });
export const putCommission = (id: number, scope: 'CATEGORY' | 'PRODUCT', targetId: number, fixedCents: number) =>
  jfetch(`${API}/api/locations/${id}/commission`, jsonPut({ scope, targetId, fixedCents }));
export const deleteCommission = (id: number, scope: 'CATEGORY' | 'PRODUCT', targetId: number) =>
  jfetch(`${API}/api/locations/${id}/commission/${scope}/${targetId}`, { method: 'DELETE' });

// Tables ----------------------------------------------------------------------
export const getTables = () => jfetch(`${API}/api/tables`);
export const getTableByCode = (code: string) => jfetch(`${API}/api/tables/code/${code}`);
export const createTable = (data: any) => jfetch(`${API}/api/tables`, json(data));
export const updateTable = (id: number, data: any) => jfetch(`${API}/api/tables/${id}`, patch(data));
export const deleteTable = (id: number) => jfetch(`${API}/api/tables/${id}`, { method: 'DELETE' });
export const hardDeleteTable = (id: number) => jfetch(`${API}/api/tables/${id}/hard`, { method: 'DELETE' });
export const addRouteOverride = (tableId: number, fromScreenId: number, toScreenId: number) => jfetch(`${API}/api/tables/${tableId}/route-override`, json({ fromScreenId, toScreenId }));
export const deleteRouteOverride = (tableId: number, fromScreenId: number) => jfetch(`${API}/api/tables/${tableId}/route-override/${fromScreenId}`, { method: 'DELETE' });

// Orders ----------------------------------------------------------------------
export const createOrder = (payload: any) => jfetch(`${API}/api/orders`, json(payload));
export const getOrders = (params: { status?: string; locationId?: number; prepScreenId?: number; tableId?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.locationId) q.set('locationId', String(params.locationId));
  if (params.prepScreenId) q.set('prepScreenId', String(params.prepScreenId));
  if (params.tableId) q.set('tableId', String(params.tableId));
  return jfetch(`${API}/api/orders?${q.toString()}`);
};
export const setOrderStatus = (id: number, status: string) => jfetch(`${API}/api/orders/${id}/status`, json({ status }));
export const setItemStatus = (orderId: number, itemId: number, status: string) => jfetch(`${API}/api/orders/${orderId}/items/${itemId}/status`, json({ status }));
export const getOrderByToken = (token: string) => jfetch(`${API}/api/orders/by-token/${token}`);
export const cancelOrderByToken = (token: string) => jfetch(`${API}/api/orders/by-token/${token}/cancel`, json({}));

// Payments --------------------------------------------------------------------
export const createPayment = (orderId: number) => jfetch(`${API}/api/payments/create`, json({ orderId }));
export const getPaymentStatus = (orderId: number) => jfetch(`${API}/api/payments/status/${orderId}`);

// Stats -----------------------------------------------------------------------
export const getStats = (params: { locationId?: number; date?: string; from?: string; to?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.locationId) q.set('locationId', String(params.locationId));
  if (params.date) q.set('date', params.date);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  return jfetch(`${API}/api/stats?${q.toString()}`);
};

// Delivery agents -------------------------------------------------------------
export const getAgents = () => jfetch(`${API}/api/agents`);
export const createAgent = (name: string, phone?: string) => jfetch(`${API}/api/agents`, json({ name, phone }));
export const updateAgent = (id: number, data: any) => jfetch(`${API}/api/agents/${id}`, patch(data));
export const deleteAgent = (id: number) => jfetch(`${API}/api/agents/${id}`, { method: 'DELETE' });

// Dispatch --------------------------------------------------------------------
export const getDispatchOrders = () => jfetch(`${API}/api/dispatch/orders`);
export const assignAgent = (orderId: number, agentId: number) => jfetch(`${API}/api/dispatch/orders/${orderId}/assign`, json({ agentId }));
export const unassignAgent = (orderId: number) => jfetch(`${API}/api/dispatch/orders/${orderId}/unassign`, json({}));
export const markPickup = (orderId: number) => jfetch(`${API}/api/dispatch/orders/${orderId}/pickup`, json({}));
export const postCustomerPosition = (token: string, lat: number, lon: number, accuracy?: number) =>
  jfetch(`${API}/api/dispatch/orders/by-token/${token}/position`, json({ lat, lon, accuracy }));
export const postAgentPosition = (code: string, lat: number, lon: number, accuracy?: number, heading?: number, orderId?: number) =>
  jfetch(`${API}/api/dispatch/agents/${code}/position`, json({ lat, lon, accuracy, heading, orderId }));
export const getOrderPositions = (orderId: number) => jfetch(`${API}/api/dispatch/orders/${orderId}/positions`);
export const getAgentActiveOrder = (code: string) => jfetch(`${API}/api/dispatch/agents/${code}/active-order`);
export const getAgentActiveOrders = (code: string) => jfetch(`${API}/api/dispatch/agents/${code}/active-orders`);
