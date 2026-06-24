// Thin Leaflet wrapper shared by customer track + agent pages.
// Leaflet is imported dynamically to keep the initial bundle small and
// avoid SSR/non-browser issues.
import type LType from 'leaflet';

// Static OpenStreetMap embed centered on a point, with a marker — used for the
// lightweight, non-interactive mini-map on the bezorger screen.
export function osmEmbedUrl(lat: number, lon: number, spanLon = 0.006): string {
  const spanLat = spanLon * 0.5; // rough aspect for the short, wide map frame
  const f = (n: number) => n.toFixed(5);
  const bbox = `${f(lon - spanLon)}%2C${f(lat - spanLat)}%2C${f(lon + spanLon)}%2C${f(lat + spanLat)}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${f(lat)}%2C${f(lon)}`;
}

let LPromise: Promise<typeof LType> | null = null;
export function loadLeaflet(): Promise<typeof LType> {
  if (!LPromise) {
    LPromise = import('leaflet').then(async (mod) => {
      const L = mod.default || (mod as any);
      // CSS must be loaded for tiles/markers to render correctly.
      await import('leaflet/dist/leaflet.css');
      return L;
    });
  }
  return LPromise;
}

export type MapHandle = {
  L: typeof LType;
  map: LType.Map;
  setCustomer: (lat: number, lon: number, label?: string) => void;
  setAgent: (lat: number, lon: number, heading?: number) => void;
  setTrail: (points: { lat: number; lon: number }[]) => void;
  fit: () => void;
  destroy: () => void;
};

export async function createTrackMap(container: HTMLElement): Promise<MapHandle> {
  const L = await loadLeaflet();
  const map = L.map(container, { zoomControl: true, attributionControl: true }).setView([50.78, 3.04], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  let customerMarker: LType.Marker | null = null;
  let agentMarker: LType.Marker | null = null;
  let trailLine: LType.Polyline | null = null;

  const blue = L.divIcon({ html: '🔵', className: 'map-divicon', iconSize: [28, 28], iconAnchor: [14, 14] });
  const red = L.divIcon({ html: '🛵', className: 'map-divicon', iconSize: [32, 32], iconAnchor: [16, 16] });

  return {
    L, map,
    setCustomer(lat, lon, label) {
      if (customerMarker) customerMarker.setLatLng([lat, lon]);
      else customerMarker = L.marker([lat, lon], { icon: blue }).addTo(map).bindPopup(label || 'Klant');
    },
    setAgent(lat, lon) {
      if (agentMarker) agentMarker.setLatLng([lat, lon]);
      else agentMarker = L.marker([lat, lon], { icon: red }).addTo(map).bindPopup('Bezorger');
    },
    setTrail(points) {
      if (trailLine) { map.removeLayer(trailLine); trailLine = null; }
      if (points.length > 1) {
        trailLine = L.polyline(points.map((p) => [p.lat, p.lon] as [number, number]), { color: '#1976D2', weight: 3, opacity: 0.6, dashArray: '6,6' }).addTo(map);
      }
    },
    fit() {
      const pts: [number, number][] = [];
      if (customerMarker) pts.push(customerMarker.getLatLng() as any);
      if (agentMarker) pts.push(agentMarker.getLatLng() as any);
      if (pts.length === 1) map.setView(pts[0], 16);
      else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.2));
    },
    destroy() { map.remove(); },
  };
}
