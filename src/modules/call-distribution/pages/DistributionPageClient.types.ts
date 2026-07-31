export type LeafletMapRuntime = {
  setView: (center: [number, number], zoom: number) => LeafletMapRuntime;
  invalidateSize: () => void;
  fitBounds: (bounds: unknown[], options?: { padding?: [number, number] }) => void;
  remove: () => void;
};

export type LeafletLayerRuntime = {
  clearLayers: () => void;
};

export type LeafletCircleRuntime = {
  bindPopup: (content: string, options?: { className?: string }) => void;
  on: (event: string, handler: () => void) => void;
  addTo: (layer: LeafletLayerRuntime) => void;
};

export type LeafletRuntime = {
  map: (
    element: HTMLDivElement,
    options?: { zoomControl?: boolean; attributionControl?: boolean; preferCanvas?: boolean }
  ) => LeafletMapRuntime;
  tileLayer: (
    template: string,
    options?: { maxZoom?: number }
  ) => { addTo: (map: LeafletMapRuntime) => void };
  control: { zoom: (options?: { position?: string }) => { addTo: (map: LeafletMapRuntime) => void } };
  layerGroup: () => { addTo: (map: LeafletMapRuntime) => LeafletLayerRuntime };
  circleMarker: (
    latLng: [number, number],
    options?: { radius?: number; color?: string; fillColor?: string; fillOpacity?: number; weight?: number }
  ) => LeafletCircleRuntime;
};
