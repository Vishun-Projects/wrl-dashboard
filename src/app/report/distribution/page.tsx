'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  MapPin,
  Users,
  SlidersHorizontal,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Map as LucideMap,
  FilterX,
} from 'lucide-react';
import { toast } from 'sonner';
import { RegisterPageFilters } from '@/components/RegisterPageFilters';
import { PageShell, PageLoadingState } from '@/components/PageShell';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import { filterViewCalls } from '@/lib/report-search';
import { buildCorpusViewDateFilter, filterCorpusCallsByViewDate } from '@/lib/report-corpus';
import { toDateString } from '@/lib/report-filters';
import { classifyTrhcallRow } from '@/lib/trhcalls-query';

// Helper to inject Leaflet CDN resources dynamically
const loadLeaflet = () => {
  return new Promise<boolean>((resolve) => {
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

    if ((window as any).L) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
};

export default function CallDistributionPage() {
  const {
    dateRange,
    dateFilterColumn,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedCallTypes,
    selectedStatus,
    priorityFilter,
    portalFilter,
    pincodeSearch,
    distributionCalls,
    distributionBranches,
    distributionLoading,
    fetchDistributionData,
    rehydrateDistributionFromCache,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
  } = useReportFilters();

  const [mounted, setMounted] = useState(false);

  const startDateStr = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDateStr = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const viewDateFilter = useMemo(
    () => buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn),
    [startDateStr, endDateStr, dateFilterColumn]
  );

  // Leaflet map refs
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);

  const [selectedPincode, setSelectedPincode] = useState('All');

  // Loading States
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // Invalidate map size when shown again
  useEffect(() => {
    if (showMap && mapInstanceRef.current) {
      setTimeout(() => mapInstanceRef.current.invalidateSize(), 150);
    }
  }, [showMap]);

  // Aggregated API Data States
  const [metrics, setMetrics] = useState({
    totalCalls: 0,
    openCalls: 0,
    solvedCalls: 0,
    cancelledCalls: 0,
    franchiseesCount: 0,
    activeTechniciansCount: 0,
    callToTechnicianRatio: 0
  });
  const [franchiseeSummary, setFranchiseeSummary] = useState<any[]>([]);
  const [pincodeSummary, setPincodeSummary] = useState<any[]>([]);

  // Loading & Sorting States
  const [sortField, setSortField] = useState('ratio');
  const [sortAsc, setSortAsc] = useState(false);
  const [highlightedFranchisee, setHighlightedFranchisee] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    rehydrateDistributionFromCache();
  }, [rehydrateDistributionFromCache]);

  useEffect(() => {
    if (distributionCalls.length > 0) {
      syncCascadeOptionsFromCalls(distributionCalls);
    }
  }, [distributionCalls, selectedState, selectedCity, selectedBranch, selectedFranchisee, selectedTechnician, selectedCallTypes, selectedStatus, priorityFilter, portalFilter, pincodeSearch, syncCascadeOptionsFromCalls]);

  const distributionViewFilters = useMemo(
    () => ({
      search: '',
      pincodeSearch,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedCallTypes,
      selectedOfficeIds: [] as string[],
      selectedStatus,
      priorityFilter,
      portalFilter,
    }),
    [
      pincodeSearch,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedCallTypes,
      selectedStatus,
      priorityFilter,
      portalFilter,
    ]
  );

  // CSR Metrics & Dashboard Aggregations Computation
  useEffect(() => {
    if (distributionCalls.length === 0) {
      setMetrics({
        totalCalls: 0,
        openCalls: 0,
        solvedCalls: 0,
        cancelledCalls: 0,
        franchiseesCount: 0,
        activeTechniciansCount: 0,
        callToTechnicianRatio: 0
      });
      setFranchiseeSummary([]);
      setPincodeSummary([]);
      return;
    }

    const dateFilteredCalls = filterCorpusCallsByViewDate(distributionCalls, viewDateFilter);
    const filteredCalls = filterViewCalls(dateFilteredCalls, distributionViewFilters);

    const franchiseeMap = new Map();
    const pincodeMap = new Map();

    let totalCallsCount = 0;
    let openCallsCount = 0;
    let solvedCallsCount = 0;
    let cancelledCallsCount = 0;
    const activeTechsSet = new Set();
    const activeFranchiseesSet = new Set();

    filteredCalls.forEach((c: any) => {
      totalCallsCount++;
      const bucket = classifyTrhcallRow(c);

      if (bucket === 'cancelled') cancelledCallsCount++;
      else if (bucket === 'solved') solvedCallsCount++;
      else openCallsCount++;

      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        activeTechsSet.add(c.nengineer);
      }

      const fCode = c.franchisee_code || 'UNASSIGNED';
      const fName = c.franchisee_name || 'Unallocated';
      if (c.franchisee_code) {
        activeFranchiseesSet.add(c.franchisee_code);
      }

      // Franchisee aggregate
      if (!franchiseeMap.has(fCode)) {
        franchiseeMap.set(fCode, {
          franchisee_code: fCode,
          franchisee_name: fName,
          techs: new Set(),
          total_calls: 0,
          open_calls: 0,
          closed_calls: 0,
          tech_solved: 0
        });
      }
      const fObj = franchiseeMap.get(fCode);
      fObj.total_calls++;
      if (bucket === 'cancelled') {
        fObj.closed_calls++;
      } else if (bucket === 'solved') {
        fObj.closed_calls++;
        if (String(c.bfastclose).toLowerCase() === 'true' || c.bfastclose === 1 || c.bfastclose === '1') {
          fObj.tech_solved++;
        }
      } else {
        fObj.open_calls++;
      }
      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        fObj.techs.add(c.nengineer);
      }

      // Pincode aggregate
      const pincode = c.pincode || 'UNKNOWN';
      const pinKey = `${pincode}-${fCode}`;

      if (!pincodeMap.has(pinKey)) {
        pincodeMap.set(pinKey, {
          pincode,
          lat: c.lat,
          lng: c.lng,
          city_name: c.city,
          state_name: c.state,
          franchisee_name: fName,
          franchisee_code: fCode,
          total_calls: 0,
          open_calls: 0
        });
      }
      const pinObj = pincodeMap.get(pinKey);
      pinObj.total_calls++;
      if (bucket === 'open') {
        pinObj.open_calls++;
      }
    });

    const franchiseeSummary = Array.from(franchiseeMap.values()).map((f: any) => {
      const techCount = f.techs.size;
      const ratio = techCount > 0 ? parseFloat((f.total_calls / techCount).toFixed(2)) : f.total_calls;
      return {
        franchisee_code: f.franchisee_code,
        franchisee_name: f.franchisee_name,
        technicians_count: techCount,
        total_calls: f.total_calls,
        open_calls: f.open_calls,
        closed_calls: f.closed_calls,
        tech_solved: f.tech_solved || 0,
        ratio
      };
    });

    franchiseeSummary.sort((a, b) => b.ratio - a.ratio);

    const pincodeFinalMap = new Map();
    pincodeMap.forEach((pin: any) => {
      if (!pincodeFinalMap.has(pin.pincode)) {
        pincodeFinalMap.set(pin.pincode, {
          pincode: pin.pincode,
          lat: pin.lat,
          lng: pin.lng,
          city_name: pin.city_name,
          state_name: pin.state_name,
          total_calls: 0,
          open_calls: 0,
          franchisees: []
        });
      }
      const pf = pincodeFinalMap.get(pin.pincode);
      pf.total_calls += pin.total_calls;
      pf.open_calls += pin.open_calls;
      pf.franchisees.push({
        franchisee_name: pin.franchisee_name,
        franchisee_code: pin.franchisee_code,
        total_calls: pin.total_calls
      });
    });

    const pincodeSummary = Array.from(pincodeFinalMap.values()).map((pin: any) => {
      return {
        pincode: pin.pincode,
        lat: pin.lat,
        lng: pin.lng,
        total_calls: pin.total_calls,
        open_calls: pin.open_calls,
        franchisees: pin.franchisees
      };
    });

    setMetrics({
      totalCalls: totalCallsCount,
      openCalls: openCallsCount,
      solvedCalls: solvedCallsCount,
      cancelledCalls: cancelledCallsCount,
      franchiseesCount: activeFranchiseesSet.size,
      activeTechniciansCount: activeTechsSet.size,
      callToTechnicianRatio: activeTechsSet.size > 0 ? parseFloat((openCallsCount / activeTechsSet.size).toFixed(2)) : openCallsCount
    });
    setFranchiseeSummary(franchiseeSummary);
    setPincodeSummary(pincodeSummary);
  }, [distributionCalls, distributionViewFilters, viewDateFilter]);

  // Leaflet Map Initialization
  useEffect(() => {
    if (typeof window === 'undefined' || !resourcesLoaded) return;

    loadLeaflet().then((success) => {
      if (!success) {
        setMapLoadError(true);
        return;
      }
      const L = (window as any).L;
      if (!L || !mapRef.current) {
        return;
      }

      if (!mapInstanceRef.current) {
        try {
          const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false,
            preferCanvas: true
          }).setView([20.5937, 78.9629], 5);

          L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 18
          }).addTo(map);

          L.control.zoom({ position: 'topright' }).addTo(map);

          mapInstanceRef.current = map;
          markersLayerRef.current = L.layerGroup().addTo(map);
          setMapReady(true);

          setTimeout(() => {
            if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
            }
          }, 150);
        } catch {
          setMapLoadError(true);
        }
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        setMapReady(false);
      }
    };
  }, [resourcesLoaded]);

  // Leaflet Map Markers Re-render
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!L || !map || !layer || !pincodeSummary || !mapReady) return;

    const timer = setTimeout(() => {
      // Force map to recalculate container size on data updates
      map.invalidateSize();

      // Reset markers
      layer.clearLayers();

      const bounds: any[] = [];

      // Filter points based on highlighted Franchisee, selected Pincode, or Pincode Search
      const filteredPoints = pincodeSummary.filter(pin => {
        if (pincodeSearch && !pin.pincode.toLowerCase().includes(pincodeSearch.toLowerCase())) return false;
        if (selectedPincode !== 'All' && pin.pincode !== selectedPincode) return false;
        if (highlightedFranchisee) {
          return pin.franchisees.some((f: any) => f.franchisee_code === highlightedFranchisee);
        }
        return true;
      });

      filteredPoints.forEach((pin: any) => {
        // Metric logic: Health status by open calls backlog
        // Orange/Red for high backlog pincodes, Green for balanced
        let color = '#10b981'; // Green
        if (pin.open_calls > 15) {
          color = '#ef4444'; // Red
        } else if (pin.open_calls >= 8) {
          color = '#f59e0b'; // Amber
        }

        // Radius scale in pixels for clean, zoom-consistent plotting
        const pixelRadius = Math.min(Math.max(pin.total_calls * 1.5, 6), 18);

        const circle = L.circleMarker([pin.lat, pin.lng], {
          radius: pixelRadius,
          color: '#ffffff',
          fillColor: color,
          fillOpacity: 0.7,
          weight: 1.5
        });

        // HTML Tooltip contents (Premium Light Mode styling)
        const popupContent = `
          <div class="p-2.5 text-slate-800 font-sans min-w-[220px] bg-white rounded-xl border border-slate-200/80 shadow-xl">
            <h4 class="font-bold border-b border-slate-100 pb-1.5 mb-1.5 flex justify-between items-center text-xs text-slate-900">
              <span>Pincode: <b class="text-teal-650">${pin.pincode}</b></span>
              <span class="px-1.5 py-0.5 rounded-full text-[9px] bg-slate-100 text-slate-650 font-bold">Cluster</span>
            </h4>
            <div class="space-y-1 text-[11px] text-slate-600">
              <p>Total Active Calls: <b class="text-slate-950 font-semibold">${pin.total_calls}</b></p>
              <p>Open Backlog: <b class="text-amber-600 font-bold">${pin.open_calls}</b></p>
              <div class="border-t border-slate-100 mt-1.5 pt-1.5 max-h-[90px] overflow-y-auto space-y-1">
                ${pin.franchisees.map((f: any) => `
                  <div class="flex justify-between items-center text-[10px] text-slate-500">
                    <span class="truncate pr-1 font-medium">${f.franchisee_name}</span>
                    <span class="font-bold text-slate-800">${f.total_calls}</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <p class="mt-2 text-[9px] text-teal-600 italic font-semibold cursor-pointer">Click to focus details table</p>
          </div>
        `;

        circle.bindPopup(popupContent, {
          className: 'custom-leaflet-popup'
        });

        // Filter table on click
        circle.on('click', () => {
          setSelectedPincode(pin.pincode);
          toast.info(`Focused on Pincode cluster ${pin.pincode}`);
        });

        circle.addTo(layer);
        bounds.push([pin.lat, pin.lng]);
      });

      // Auto-fit to active bounds
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [pincodeSummary, highlightedFranchisee, selectedPincode, mapReady, pincodeSearch]);

  // Sorting Logic for Franchisee Table
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortedFranchiseeList = useMemo(() => {
    const s = [...franchiseeSummary];
    s.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });
    return s;
  }, [franchiseeSummary, sortField, sortAsc]);


  if (!resourcesLoaded || !mounted) {
    return <PageLoadingState label="Loading Call Distribution..." />;
  }

  return (
    <PageShell
      title="Call Distribution Audit"
      subtitle="Are branch calls fairly distributed across franchise technicians?"
      icon={<LucideMap size={16} className="text-teal-600" />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
      toolbar={
        <RegisterPageFilters
          loadingLabel="Loading calls for distribution map…"
          onClearAll={() => {
            setSelectedPincode('All');
            setHighlightedFranchisee(null);
          }}
        />
      }
      actions={
        <>
          {selectedPincode !== 'All' && (
            <button
              onClick={() => setSelectedPincode('All')}
              className="flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 shadow-sm transition-all hover:bg-teal-100/50"
            >
              <FilterX size={13} />
              Clear Pincode ({selectedPincode})
            </button>
          )}
          <button
            onClick={() => fetchDistributionData(true)}
            disabled={distributionLoading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 ui-label"
          >
            <RefreshCw size={13} className={distributionLoading ? 'animate-spin' : ''} />
            Recalculate
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-800 ui-label"
          >
            <SlidersHorizontal size={13} />
            Detailed Register
          </Link>
        </>
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">

        {/* Left Side: Call Distribution Map */}
        <div className={`${showMap ? 'w-full lg:w-1/2 h-[350px] lg:h-full border-r' : 'hidden'} relative border-slate-200/80 bg-slate-50 flex-shrink-0`}>
          <div ref={mapRef} className="w-full h-full z-10" />

          {/* Simple overlay when Map is not ready */}
          {!mapReady ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-50 text-slate-450 gap-3 z-20">
              <div className="w-7 h-7 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
              <div className="text-center space-y-0.5">
                <p className="text-xs font-bold text-slate-700">
                  {mapLoadError ? "Map Load Failed (CDN Blocked)" : "Loading Call Distribution Map..."}
                </p>
                <p className="text-[10px] text-slate-400">
                  {mapLoadError ? "Please check your internet connection or browser settings." : "Connecting to leaflet.js..."}
                </p>
              </div>
            </div>
          ) : null}

          {/* Floating Map Indicators */}
          <div className="absolute bottom-4 left-4 z-[500] p-3 rounded-xl bg-white border border-slate-200/80 backdrop-blur shadow-lg flex flex-col gap-2 pointer-events-none">
            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold">Capacity Health Index</span>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20" />
              <span className="text-[10px] text-slate-700 font-medium">&lt; 8 open calls (Balanced)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/20" />
              <span className="text-[10px] text-slate-700 font-medium">8 - 15 open calls (Overallocated)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/20" />
              <span className="text-[10px] text-slate-700 font-medium">&gt; 15 open calls (Critical Skew)</span>
            </div>
          </div>
        </div>

        {/* Right Side: KPIs and Tables */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Stat summary — single compact row */}
          <div className="distribution-stats-bar custom-scrollbar">
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-slate-900">
                {distributionLoading ? '…' : metrics.totalCalls.toLocaleString()}
              </span>
              <span className="distribution-stat-label">Total calls</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-emerald-600">
                {distributionLoading ? '…' : metrics.solvedCalls.toLocaleString()}
              </span>
              <span className="distribution-stat-label">Solved</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-blue-600">
                {distributionLoading ? '…' : metrics.openCalls.toLocaleString()}
              </span>
              <span className="distribution-stat-label">Open</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-rose-600">
                {distributionLoading ? '…' : metrics.cancelledCalls.toLocaleString()}
              </span>
              <span className="distribution-stat-label">Cancelled</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-teal-700">
                {distributionLoading ? '…' : `${metrics.franchiseesCount} / ${metrics.activeTechniciansCount}`}
              </span>
              <span className="distribution-stat-label">ASPs / Techs</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-slate-900">
                {distributionLoading ? '…' : `${metrics.callToTechnicianRatio}x`}
              </span>
              <span className="distribution-stat-label">Calls / tech</span>
            </div>
          </div>

          {/* Load Balancer Table Section */}
          <div className="flex-1 p-6 overflow-hidden flex flex-col min-h-0">

            {/* Section Header */}
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <div>
                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Franchisee Capacity & Allocation Matrix</h3>
                <p className="text-[10px] text-slate-500">Sorted by load ratio. Franchisees at the top require immediate call re-allocation.</p>
              </div>
              <span className="text-[10px] text-slate-650 font-bold bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                Count: {franchiseeSummary.length}
              </span>
            </div>

            {/* Scrollable Table Wrapper */}
            <div className="flex-1 overflow-auto border border-slate-200 rounded-xl bg-white shadow-sm relative custom-scrollbar">

              {distributionLoading ? (
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-3.5 bg-white/80 backdrop-blur-[3px] z-30">
                  <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-slate-550 font-bold tracking-wide animate-pulse">Analyzing capacity logs...</p>
                </div>
              ) : franchiseeSummary.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                  <CheckCircle size={24} className="text-teal-600" />
                  <p className="text-xs text-slate-500 font-semibold">No active call backlog found for filters.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs select-none">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-550 font-extrabold z-20">
                    <tr>
                      <th onClick={() => handleSort('franchisee_name')} className="px-4 py-3.5 cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center gap-1">
                          Franchisee Name
                          {sortField === 'franchisee_name' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th>
                      <th onClick={() => handleSort('technicians_count')} className="px-4 py-3.5 text-center cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          Technicians
                          {sortField === 'technicians_count' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th>
                      <th onClick={() => handleSort('total_calls')} className="px-4 py-3.5 text-center cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          Total Calls
                          {sortField === 'total_calls' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th>
                      <th onClick={() => handleSort('open_calls')} className="px-4 py-3.5 text-center cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          Open Calls
                          {sortField === 'open_calls' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th>
                      {/* <th onClick={() => handleSort('tech_solved')} className="px-4 py-3.5 text-center cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          Tech Solved
                          {sortField === 'tech_solved' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th> */}
                      <th onClick={() => handleSort('ratio')} className="px-4 py-3.5 text-center cursor-pointer hover:text-slate-900 transition-colors">
                        <div className="flex items-center justify-center gap-1">
                          Ratio (Calls/Tech)
                          {sortField === 'ratio' && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </div>
                      </th>
                      <th className="px-4 py-3.5 w-[120px] text-center">Load Status</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {sortedFranchiseeList.map((fran: any) => {
                      const isHighlighted = highlightedFranchisee === fran.franchisee_code;

                      // Highlight styles depending on workload status
                      let ratioColor = 'text-emerald-600';
                      let statusBadge = 'bg-emerald-50 text-emerald-700 border-emerald-250';
                      let statusLabel = 'Balanced';

                      if (fran.ratio > 15) {
                        ratioColor = 'text-rose-600 font-bold';
                        statusBadge = 'bg-rose-50 text-rose-700 border-rose-250 animate-pulse';
                        statusLabel = 'Critical Skew';
                      } else if (fran.ratio > 7) {
                        ratioColor = 'text-amber-600 font-semibold';
                        statusBadge = 'bg-amber-50 text-amber-700 border-amber-250';
                        statusLabel = 'Overallocated';
                      }

                      return (
                        <tr
                          key={fran.franchisee_code}
                          onClick={() => {
                            setHighlightedFranchisee(isHighlighted ? null : fran.franchisee_code);
                          }}
                          className={`hover:bg-slate-50/80 cursor-pointer transition-all duration-150 ${isHighlighted ? 'bg-teal-50/70 border-l-2 border-l-teal-600' : ''}`}
                        >
                          <td className="px-4 py-3.5 font-bold text-slate-800 max-w-[200px] truncate">
                            {fran.franchisee_name}
                          </td>
                          <td className="px-4 py-3.5 text-center text-slate-600 font-semibold">
                            {fran.technicians_count}
                          </td>
                          <td className="px-4 py-3.5 text-center text-slate-600">
                            {fran.total_calls}
                          </td>
                          <td className="px-4 py-3.5 text-center font-bold text-amber-600">
                            {fran.open_calls}
                          </td>
                          {/* <td className="px-4 py-3.5 text-center text-slate-600">
                            {fran.tech_solved || 0}
                          </td> */}
                          <td className={`px-4 py-3.5 text-center font-extrabold ${ratioColor}`}>
                            {fran.ratio}x
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] border font-bold ${statusBadge}`}>
                              {statusLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

            </div>

          </div>

        </div>

      </div>
    </PageShell>
  );
}
