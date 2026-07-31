'use client';

import React, { useEffect, useRef, useState } from 'react';
import { geodesicArc, geodesicMidpoint, formatDistanceMeters } from '@/lib/geo/geodesic';
import { getLeaflet, loadLeaflet, type LeafletRuntime } from '@/lib/geo/leaflet-cdn';

type LeafletMapInstance = ReturnType<LeafletRuntime['map']>;
type LeafletLayerGroupInstance = ReturnType<LeafletRuntime['layerGroup']>;

export type CompareMapPoint = {
  lat: number;
  lng: number;
  label: string;
  title: string;
  color: string;
};

type Props = {
  stored: CompareMapPoint | null;
  expected: CompareMapPoint | null;
  visit?: CompareMapPoint | null;
  distanceM: number | null;
  mapKey: string;
};

function markerIconHtml(letter: string, color: string) {
  return `<div style="
    width:32px;height:32px;border-radius:50%;
    background:${color};color:#fff;font-weight:700;font-size:14px;
    display:flex;align-items:center;justify-content:center;
    border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);
  ">${letter}</div>`;
}

function distanceLabelHtml(km: string) {
  return `<div style="
    font-family:system-ui,sans-serif;font-size:11px;font-weight:700;
    color:#1e293b;background:#fff;padding:4px 8px;border-radius:6px;
    border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,.12);white-space:nowrap;
  ">${km}</div>`;
}

async function fetchRoadRoute(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  signal: AbortSignal
): Promise<[number, number][] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    const coords = json.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) return null;
    return coords.map(([lng, lat]) => [lat, lng] as [number, number]);
  } catch {
    return null;
  }
}

function addTileLayer(L: LeafletRuntime, map: LeafletMapInstance) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
}

export function LocationAuditCompareMap({ stored, expected, visit, distanceM, mapKey }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMapInstance | null>(null);
  const layerRef = useRef<LeafletLayerGroupInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [routeMode, setRouteMode] = useState<'loading' | 'road' | 'geodesic'>('loading');
  useEffect(() => {
    let cancelled = false;

    const destroyMap = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layerRef.current = null;
      }
      setReady(false);
    };

    destroyMap();

    void loadLeaflet().then((ok) => {
      if (cancelled) return;
      if (!ok || !mapRef.current) {
        setError(true);
        return;
      }
      const L = getLeaflet();
      if (!L) {
        setError(true);
        return;
      }
      try {
        const map = L.map(mapRef.current, {
          zoomControl: false,
          attributionControl: true,
          preferCanvas: true,
        });
        addTileLayer(L, map);
        L.control.zoom({ position: 'topright' }).addTo(map);
        mapInstanceRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        setReady(true);
        setError(false);
        requestAnimationFrame(() => {
          map.invalidateSize();
          setTimeout(() => map.invalidateSize(), 200);
        });
      } catch {
        setError(true);
      }
    });

    return () => {
      cancelled = true;
      destroyMap();
    };
  }, [mapKey]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, [ready, mapKey]);

  useEffect(() => {
    const L = getLeaflet();
    const map = mapInstanceRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !ready) return;

    let cancelled = false;
    const abort = new AbortController();

    const draw = (roadPath: [number, number][] | null) => {
      if (cancelled) return;
      layer.clearLayers();
      const boundsCoords: [number, number][] = [];

      const addMarker = (p: CompareMapPoint) => {
        const letter = p.label.charAt(0).toUpperCase();
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'location-audit-marker',
            html: markerIconHtml(letter, p.color),
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
        });
        marker.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;min-width:180px">
            <strong>${p.title}</strong><br/>
            ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
          </div>`,
          { maxWidth: 280 }
        );
        marker.addTo(layer);
        boundsCoords.push([p.lat, p.lng]);
      };

      if (expected) addMarker(expected);
      if (stored) addMarker(stored);
      if (visit) addMarker(visit);

      if (stored && expected) {
        const geodesicPath = geodesicArc(
          expected.lat,
          expected.lng,
          stored.lat,
          stored.lng
        );

        if (roadPath && roadPath.length > 1) {
          L.polyline(roadPath, {
            color: '#2563eb',
            weight: 4,
            opacity: 0.9,
          }).addTo(layer);
          for (const pt of roadPath) boundsCoords.push(pt);
          setRouteMode('road');
        } else {
          setRouteMode('geodesic');
        }

        L.polyline(geodesicPath, {
          color: '#64748b',
          weight: 2,
          dashArray: '8 10',
          opacity: 0.85,
        }).addTo(layer);

        const [midLat, midLng] = geodesicMidpoint(
          expected.lat,
          expected.lng,
          stored.lat,
          stored.lng
        );
        const distLabel = distanceM != null ? formatDistanceMeters(distanceM) : '';
        if (distLabel) {
          L.marker([midLat, midLng], {
            icon: L.divIcon({
              className: 'location-audit-distance-label',
              html: distanceLabelHtml(distLabel),
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: false,
          }).addTo(layer);
        }
      }

      if (boundsCoords.length === 1) {
        map.setView(boundsCoords[0], 14);
      } else if (boundsCoords.length > 1) {
        const bounds = L.latLngBounds(boundsCoords).pad(0.12);
        const maxZoom =
          distanceM != null && distanceM > 50_000
            ? 5
            : distanceM != null && distanceM > 5000
              ? 8
              : 14;
        map.fitBounds(bounds, { maxZoom, padding: [40, 40] });
      }

      setTimeout(() => map.invalidateSize(), 80);
    };

    setRouteMode('loading');

    if (stored && expected) {
      void fetchRoadRoute(
        expected.lat,
        expected.lng,
        stored.lat,
        stored.lng,
        abort.signal
      ).then((road) => {
        if (!cancelled) draw(road);
      });
    } else {
      draw(null);
    }

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [stored, expected, distanceM, ready, mapKey]);

  if (error) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-slate-200 bg-bg-soft text-[11px] text-slate-500">
        Map could not load. Use the coordinate cards and Google Maps links below.
      </div>
    );
  }

  return (
    <div className="relative z-0 h-[380px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <div ref={mapRef} className="absolute inset-0 z-0 h-full w-full" style={{ minHeight: 280 }} />
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/90 text-[11px] text-slate-500">
          Loading map…
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-bg-canvas/95 px-2.5 py-2 text-[11px] font-medium text-slate-700 shadow-md">
          {expected ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />
              E — Expected (install)
            </span>
          ) : null}
          {stored ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-600" />
              S — Stored (completed)
            </span>
          ) : null}
          {visit ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600" />
              V — Visit capture
            </span>
          ) : null}
        </div>
        {stored && expected && ready ? (
          <div className="max-w-[200px] rounded-md bg-bg-canvas/95 px-2 py-1 text-[9px] leading-snug text-slate-600 shadow-sm">
            {routeMode === 'loading' && 'Loading road route…'}
            {routeMode === 'road' && (
              <>
                <span className="font-semibold text-blue-700">Blue</span> road ·{' '}
                <span className="text-slate-500">grey dashed</span> geodesic
              </>
            )}
            {routeMode === 'geodesic' && 'Grey dashed = geodesic gap'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
