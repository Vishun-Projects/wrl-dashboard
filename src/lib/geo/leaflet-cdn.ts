export function loadLeaflet(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if ((window as Window & { L?: unknown }).L) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export type LeafletRuntime = {
  map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: LeafletMap) => unknown };
  layerGroup: () => LeafletLayerGroup;
  control: { zoom: (opts: { position: string }) => { addTo: (m: LeafletMap) => unknown } };
  divIcon: (opts: Record<string, unknown>) => unknown;
  marker: (latlng: [number, number], opts?: Record<string, unknown>) => LeafletMarker;
  polyline: (
    latlngs: [number, number][],
    opts?: Record<string, unknown>
  ) => { addTo: (layer: LeafletLayerGroup) => unknown };
  latLngBounds: (points: [number, number][]) => { pad: (n: number) => unknown };
};

type LeafletMap = {
  setView: (center: [number, number], zoom: number) => void;
  fitBounds: (bounds: unknown, opts?: Record<string, unknown>) => void;
  remove: () => void;
  invalidateSize: () => void;
};

type LeafletLayerGroup = {
  addTo: (m: LeafletMap) => LeafletLayerGroup;
  clearLayers: () => void;
};

type LeafletMarker = {
  addTo: (layer: LeafletLayerGroup) => LeafletMarker;
  bindPopup: (html: string, opts?: Record<string, unknown>) => LeafletMarker;
};

export function getLeaflet(): LeafletRuntime | null {
  return (window as Window & { L?: LeafletRuntime }).L ?? null;
}
