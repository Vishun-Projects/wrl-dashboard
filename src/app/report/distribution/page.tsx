'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { 
  MapPin, 
  Users, 
  SlidersHorizontal, 
  RefreshCw, 
  ChevronUp, 
  ChevronDown, 
  AlertTriangle, 
  CheckCircle,
  Calendar,
  Layers,
  Map as LucideMap,
  FilterX
} from 'lucide-react';
import { toast } from 'sonner';

// Helper to inject Leaflet CDN resources dynamically
const loadLeaflet = () => {
  console.log("[loadLeaflet] Called. typeof window:", typeof window);
  return new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') {
      console.log("[loadLeaflet] window is undefined (SSR). Resolving false.");
      resolve(false);
      return;
    }

    // Dynamically load Leaflet CSS to avoid race conditions or unstyled rendering
    if (!document.getElementById('leaflet-css')) {
      console.log("[loadLeaflet] Injected leaflet.css link into head");
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if ((window as any).L) {
      console.log("[loadLeaflet] window.L already exists. Resolving true immediately.");
      resolve(true);
      return;
    }
    
    console.log("[loadLeaflet] window.L not found. Creating script element for leaflet.js");
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      console.log("[loadLeaflet] leaflet.js loaded successfully. L exists:", !(!(window as any).L));
      resolve(true);
    };
    script.onerror = (e) => {
      console.error("[loadLeaflet] Failed to load Leaflet CDN scripts.", e);
      resolve(false);
    };
    document.head.appendChild(script);
  });
};

export default function CallDistributionPage() {
  // Leaflet map refs
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);

  // Filter States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedState, setSelectedState] = useState('All');
  const [selectedCity, setSelectedCity] = useState('All');
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedFranchisee, setSelectedFranchisee] = useState('All');
  const [selectedTechnician, setSelectedTechnician] = useState('All');
  const [selectedCallType, setSelectedCallType] = useState('BREAKDOWN');
  const [selectedPincode, setSelectedPincode] = useState('All');
  const [pincodeSearch, setPincodeSearch] = useState('');

  // Dynamic filter lists
  const [statesList, setStatesList] = useState<any[]>([]);
  const [citiesList, setCitiesList] = useState<any[]>([]);
  const [branchesList, setBranchesList] = useState<any[]>([]);
  const [franchiseesList, setFranchiseesList] = useState<any[]>([]);
  const [techniciansList, setTechniciansList] = useState<any[]>([]);
  const [callTypesList, setCallTypesList] = useState<any[]>([]);

  // Loading States
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState(false);

  // Aggregated API Data States
  const [metrics, setMetrics] = useState({
    totalCalls: 0,
    openCalls: 0,
    closedCalls: 0,
    franchiseesCount: 0,
    activeTechniciansCount: 0,
    callToTechnicianRatio: 0
  });
  const [franchiseeSummary, setFranchiseeSummary] = useState<any[]>([]);
  const [pincodeSummary, setPincodeSummary] = useState<any[]>([]);
  const [allCalls, setAllCalls] = useState<any[]>([]);
  const [dbBranches, setDbBranches] = useState<any[]>([]);
  
  // Loading & Sorting States
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState('ratio');
  const [sortAsc, setSortAsc] = useState(false);
  const [highlightedFranchisee, setHighlightedFranchisee] = useState<string | null>(null);

  // Initialize: set default dates and load call types configuration
  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const start = thirtyDaysAgo.toISOString().split('T')[0];
    const end = today.toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);

    axios.get('/api/distribution?meta=true')
      .then(res => {
        const data = res.data || {};
        setCallTypesList(data.callTypes || []);
      })
      .catch(err => {
        toast.error('Failed to load call types configuration');
        console.error(err);
      })
      .finally(() => {
        setLoadingMeta(false);
      });
  }, []);

  // Helper to filter calls on the client
  const filterCallsCSR = (calls: any[], criteria: any, exclude?: string) => {
    return calls.filter((c) => {
      if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
        if (c.state !== criteria.state) return false;
      }
      if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
        if (c.city !== criteria.city) return false;
      }
      if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
        if (String(c.resolved_branch_code) !== criteria.branch) return false;
      }
      if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
        const cFranCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
        if (cFranCode !== criteria.franchisee) return false;
      }
      if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
        if (String(c.nengineer) !== criteria.technician) return false;
      }
      return true;
    });
  };

  // Fetch Dashboard Stats, Coordinates & Cascading Filter Options
  const fetchDashboardData = async (refresh: boolean = false) => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const params = {
        startDate,
        endDate,
        callType: selectedCallType,
        refresh: refresh ? 'true' : 'false'
      };

      const res = await axios.get('/api/distribution', { params });
      const { allCalls: fetchedCalls, dbBranches: fetchedBranches } = res.data || {};

      if (fetchedCalls) setAllCalls(fetchedCalls);
      if (fetchedBranches) setDbBranches(fetchedBranches);
    } catch (err) {
      toast.error('Error fetching call distribution report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Trigger fetch when primary date range or call type changes (debounced to avoid network request spam)
  useEffect(() => {
    if (!startDate || !endDate || loadingMeta) return;

    const timer = setTimeout(() => {
      fetchDashboardData();
    }, 350);

    return () => clearTimeout(timer);
  }, [startDate, endDate, selectedCallType, loadingMeta]);

  // CSR Dropdown Cascades Computation
  useEffect(() => {
    if (allCalls.length === 0) {
      setStatesList([]);
      setCitiesList([]);
      setBranchesList([]);
      setFranchiseesList([]);
      setTechniciansList([]);
      return;
    }

    const criteria = {
      state: selectedState,
      city: selectedCity,
      branch: selectedBranch,
      franchisee: selectedFranchisee,
      technician: selectedTechnician
    };

    // States (exclude state filter)
    const statesFiltered = filterCallsCSR(allCalls, criteria, 'state');
    const stateCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
    statesFiltered.forEach((c) => {
      if (!c.state) return;
      const sName = c.state;
      if (!stateCounts[sName]) {
        stateCounts[sName] = { ncode: sName, vname: sName, call_count: 0 };
      }
      stateCounts[sName].call_count++;
    });
    const states = Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname));
    setStatesList(states);

    // Cities (exclude city filter)
    const citiesFiltered = filterCallsCSR(allCalls, criteria, 'city');
    const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
    citiesFiltered.forEach((c) => {
      if (!c.city) return;
      const cName = c.city;
      if (!cityCounts[cName]) {
        cityCounts[cName] = { ncode: cName, vname: cName, nstate: c.state || '', call_count: 0 };
      }
      cityCounts[cName].call_count++;
    });
    const cities = Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname));
    setCitiesList(cities);

    // Branches (exclude branch filter)
    const branchesFiltered = filterCallsCSR(allCalls, criteria, 'branch');
    const branchCallCounts: Record<string, number> = {};
    branchesFiltered.forEach((c) => {
      if (!c.resolved_branch_code) return;
      const bCode = String(c.resolved_branch_code);
      branchCallCounts[bCode] = (branchCallCounts[bCode] || 0) + 1;
    });
    const branches = dbBranches.map((dbB: any) => {
      const bCode = String(dbB.ncode);
      return {
        ncode: bCode,
        vcompanyname: dbB.vcompanyname,
        call_count: branchCallCounts[bCode] || 0
      };
    }).filter((b: any) => b.call_count > 0);
    setBranchesList(branches);

    // Franchisees (exclude franchisee filter)
    const franchiseesFiltered = filterCallsCSR(allCalls, criteria, 'franchisee');
    const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; nunder: string; call_count: number }> = {};
    franchiseesFiltered.forEach((c) => {
      const fCode = String(c.franchisee_code || 'UNASSIGNED');
      const fName = c.franchisee_name || 'Unallocated';
      if (!franchiseeCounts[fCode]) {
        franchiseeCounts[fCode] = { ncode: fCode, vcompanyname: fName, nunder: String(c.office_under || ''), call_count: 0 };
      }
      franchiseeCounts[fCode].call_count++;
    });
    const franchisees = Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));
    setFranchiseesList(franchisees);

    // Technicians (exclude technician filter)
    const techniciansFiltered = filterCallsCSR(allCalls, criteria, 'technician');
    const techCounts: Record<string, { ncode: string; vname: string; nofficeid: string; call_count: number }> = {};
    techniciansFiltered.forEach((c) => {
      if (!c.nengineer || c.nengineer === '0' || c.nengineer === 0) return;
      const tCode = String(c.nengineer);
      if (!techCounts[tCode]) {
        techCounts[tCode] = { ncode: tCode, vname: c.technician_name || 'UNKNOWN', nofficeid: String(c.technician_office_id || ''), call_count: 0 };
      }
      techCounts[tCode].call_count++;
    });
    const technicians = Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname));
    setTechniciansList(technicians);

  }, [allCalls, dbBranches, selectedState, selectedCity, selectedBranch, selectedFranchisee, selectedTechnician]);

  // CSR Dropdown Option Validation & Safe Resets
  useEffect(() => {
    if (statesList.length > 0 && selectedState !== 'All' && !statesList.some((s: any) => s.vname === selectedState)) {
      setSelectedState('All');
    }
    if (citiesList.length > 0 && selectedCity !== 'All' && !citiesList.some((c: any) => String(c.ncode) === String(selectedCity))) {
      setSelectedCity('All');
    }
    if (branchesList.length > 0 && selectedBranch !== 'All' && !branchesList.some((b: any) => String(b.ncode) === String(selectedBranch))) {
      setSelectedBranch('All');
    }
    if (franchiseesList.length > 0 && selectedFranchisee !== 'All' && !franchiseesList.some((f: any) => String(f.ncode) === String(selectedFranchisee))) {
      setSelectedFranchisee('All');
    }
    if (techniciansList.length > 0 && selectedTechnician !== 'All' && !techniciansList.some((t: any) => String(t.ncode) === String(selectedTechnician))) {
      setSelectedTechnician('All');
    }
  }, [statesList, citiesList, branchesList, franchiseesList, techniciansList]);

  // CSR Metrics & Dashboard Aggregations Computation
  useEffect(() => {
    if (allCalls.length === 0) {
      setMetrics({
        totalCalls: 0,
        openCalls: 0,
        closedCalls: 0,
        franchiseesCount: 0,
        activeTechniciansCount: 0,
        callToTechnicianRatio: 0
      });
      setFranchiseeSummary([]);
      setPincodeSummary([]);
      return;
    }

    const criteria = {
      state: selectedState,
      city: selectedCity,
      branch: selectedBranch,
      franchisee: selectedFranchisee,
      technician: selectedTechnician
    };

    const filteredCalls = filterCallsCSR(allCalls, criteria);

    const franchiseeMap = new Map();
    const pincodeMap = new Map();

    let totalCallsCount = 0;
    let openCallsCount = 0;
    let closedCallsCount = 0;
    const activeTechsSet = new Set();
    const activeFranchiseesSet = new Set();

    filteredCalls.forEach((c: any) => {
      totalCallsCount++;
      const isSolved = c.bsolved === true || c.bsolved === 1 || String(c.bsolved).toLowerCase() === 'true';
      const isTechSolved = c.bfastclose === true || c.bfastclose === 1 || String(c.bfastclose).toLowerCase() === 'true';
      
      if (isSolved || isTechSolved) {
        closedCallsCount++;
      } else {
        openCallsCount++;
      }

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
      if (isSolved) {
        fObj.closed_calls++;
      } else if (isTechSolved) {
        fObj.closed_calls++;
        fObj.tech_solved++;
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
      if (!isSolved) {
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
      closedCalls: closedCallsCount,
      franchiseesCount: activeFranchiseesSet.size,
      activeTechniciansCount: activeTechsSet.size,
      callToTechnicianRatio: activeTechsSet.size > 0 ? parseFloat((totalCallsCount / activeTechsSet.size).toFixed(2)) : totalCallsCount
    });
    setFranchiseeSummary(franchiseeSummary);
    setPincodeSummary(pincodeSummary);
  }, [allCalls, selectedState, selectedCity, selectedBranch, selectedFranchisee, selectedTechnician]);

  // Leaflet Map Initialization
  useEffect(() => {
    console.log("[Leaflet Map Initialization useEffect] Triggered. typeof window:", typeof window, "loadingMeta:", loadingMeta);
    if (typeof window === 'undefined' || loadingMeta) return;

    loadLeaflet().then((success) => {
      console.log("[Leaflet Map Initialization useEffect] loadLeaflet success:", success);
      if (!success) {
        console.error("[Leaflet Map Initialization useEffect] Setting mapLoadError to true.");
        setMapLoadError(true);
        return;
      }
      const L = (window as any).L;
      console.log("[Leaflet Map Initialization useEffect] Checking L and mapRef:", { LExists: !(!L), mapRefExists: !(!mapRef.current) });
      if (!L || !mapRef.current) {
        console.warn("[Leaflet Map Initialization useEffect] L or mapRef is missing. Exiting initialization.");
        return;
      }

      if (!mapInstanceRef.current) {
        console.log("[Leaflet Map Initialization useEffect] Initializing new map instance...");
        try {
          const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false,
            preferCanvas: true
          }).setView([20.5937, 78.9629], 5);

          // Premium Light Theme CartoDB Tile Layer (Positron)
          L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 18
          }).addTo(map);

          // Add Zoom Controls to Top Right
          L.control.zoom({ position: 'topright' }).addTo(map);

          mapInstanceRef.current = map;
          markersLayerRef.current = L.layerGroup().addTo(map);
          setMapReady(true);
          console.log("[Leaflet Map Initialization useEffect] Map instance created successfully.");

          // Force a resize calculation shortly after map mounts to account for flex layout sizing
          setTimeout(() => {
            if (mapInstanceRef.current) {
              console.log("[Leaflet Map Initialization useEffect] Invalidating size...");
              mapInstanceRef.current.invalidateSize();
            }
          }, 150);
        } catch (err) {
          console.error("[Leaflet Map Initialization useEffect] Exception during map initialization:", err);
        }
      } else {
        console.log("[Leaflet Map Initialization useEffect] Map instance already exists.");
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        console.log("[Leaflet Map Initialization useEffect] Cleanup: removing map instance.");
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        setMapReady(false);
      }
    };
  }, [loadingMeta]);

  // Leaflet Map Markers Re-render
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    console.log("[Map Markers Re-render] useEffect triggered. State:", {
      LExists: !(!L),
      mapExists: !(!map),
      layerExists: !(!layer),
      pincodeSummaryLength: pincodeSummary?.length,
      mapReady
    });
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
  }, [pincodeSummary, highlightedFranchisee, selectedPincode, mapReady]);

  // Trigger cascades on selections
  const handleStateChange = (stateName: string) => {
    setSelectedState(stateName);
  };

  const handleCityChange = (cityCode: string) => {
    setSelectedCity(cityCode);
  };

  const handleBranchChange = (branchId: string) => {
    setSelectedBranch(branchId);
  };

  const handleFranchiseeChange = (franId: string) => {
    setSelectedFranchisee(franId);
  };

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


  const hasActiveFilters = useMemo(() => {
    return (
      selectedState !== 'All' ||
      selectedCity !== 'All' ||
      selectedBranch !== 'All' ||
      selectedFranchisee !== 'All' ||
      selectedTechnician !== 'All' ||
      selectedCallType !== 'BREAKDOWN' ||
      selectedPincode !== 'All' ||
      pincodeSearch !== '' ||
      highlightedFranchisee !== null
    );
  }, [
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedCallType,
    selectedPincode,
    pincodeSearch,
    highlightedFranchisee
  ]);

  if (loadingMeta) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white flex-col gap-3">
        <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-bold tracking-wide animate-pulse">Initializing Call Distribution Database...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/30 text-slate-700 overflow-hidden font-sans">
      
      {/* Header Bar */}
      <header className="px-6 py-4 bg-white border-b border-slate-200/80 flex justify-between items-center flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 border border-teal-100 rounded-xl flex items-center justify-center text-teal-600 shadow-sm">
            <LucideMap size={18} />
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 tracking-wide">Call Distribution Audit</h1>
            <p className="text-[10px] text-slate-500 font-medium">Are branch calls fairly distributed across franchise technicians?</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSelectedState('All');
                setSelectedCity('All');
                setSelectedBranch('All');
                setSelectedFranchisee('All');
                setSelectedTechnician('All');
                setSelectedCallType('BREAKDOWN');
                setSelectedPincode('All');
                setPincodeSearch('');
                setHighlightedFranchisee(null);
                toast.success('All filters cleared');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 hover:bg-rose-100/50 hover:border-rose-300 transition-all font-semibold shadow-sm active:scale-98 cursor-pointer"
            >
              <FilterX size={13} className="text-rose-600" />
              Clear Filters
            </button>
          )}
          {selectedPincode !== 'All' && (
            <button
              onClick={() => setSelectedPincode('All')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-700 hover:bg-teal-100/50 transition-all font-semibold shadow-sm"
            >
              <FilterX size={13} />
              Clear Pincode Filter ({selectedPincode})
            </button>
          )}
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-55 text-xs transition-all text-slate-700 font-semibold shadow-sm disabled:opacity-50 active:scale-98"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Recalculate
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-750 text-xs transition-all text-white font-bold shadow-sm hover:shadow active:scale-98 cursor-pointer"
          >
            <SlidersHorizontal size={13} />
            Detailed Register
          </Link>
        </div>
      </header>

      {/* Cascading Filter Bar */}
      <section className="px-6 py-4 bg-slate-50 border-b border-slate-200/80 flex-shrink-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3 items-end">
        
        {/* 1. Date Range Start */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Start Date</label>
          <div className="relative">
            <input 
              type="date" 
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm"
            />
          </div>
        </div>

        {/* 2. Date Range End */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">End Date</label>
          <div className="relative">
            <input 
              type="date" 
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm"
            />
          </div>
        </div>

        {/* 3. State Cascading Dropdown */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">State</label>
            {loading && <span className="w-2.5 h-2.5 border border-teal-655 border-t-transparent rounded-full animate-spin" />}
          </div>
          <select 
            value={selectedState} 
            onChange={e => handleStateChange(e.target.value)}
            disabled={loadingMeta || loading}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer disabled:opacity-60"
          >
            <option value="All">All States</option>
            {statesList.map(s => <option key={s.ncode} value={s.vname}>{s.vname} ({s.call_count || 0})</option>)}
          </select>
        </div>

        {/* 4. City Cascading Dropdown */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">City</label>
            {loading && <span className="w-2.5 h-2.5 border border-teal-655 border-t-transparent rounded-full animate-spin" />}
          </div>
          <select 
            value={selectedCity} 
            onChange={e => handleCityChange(e.target.value)}
            disabled={loadingMeta || loading}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer disabled:opacity-60"
          >
            <option value="All">All Cities</option>
            {citiesList.map(c => <option key={c.ncode} value={c.ncode}>{c.vname} ({c.call_count || 0})</option>)}
          </select>
        </div>

        {/* 5. Pincode Search Text Input */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Pincode Search</label>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search pincode..."
              value={pincodeSearch}
              onChange={e => setPincodeSearch(e.target.value)}
              className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm placeholder-slate-400"
            />
          </div>
        </div>

        {/* 5. Branch Cascading Dropdown */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Branch</label>
            {loading && <span className="w-2.5 h-2.5 border border-teal-655 border-t-transparent rounded-full animate-spin" />}
          </div>
          <select 
            value={selectedBranch} 
            onChange={e => handleBranchChange(e.target.value)}
            disabled={loadingMeta || loading}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer disabled:opacity-60"
          >
            <option value="All">All Branches</option>
            {branchesList.map(o => <option key={o.ncode} value={o.ncode}>{o.vcompanyname} ({o.call_count || 0})</option>)}
          </select>
        </div>

        {/* 6. Franchisee Cascading Dropdown */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Franchisee (ASP)</label>
            {loading && <span className="w-2.5 h-2.5 border border-teal-655 border-t-transparent rounded-full animate-spin" />}
          </div>
          <select 
            value={selectedFranchisee} 
            onChange={e => handleFranchiseeChange(e.target.value)}
            disabled={loadingMeta || loading}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer disabled:opacity-60"
          >
            <option value="All">All Franchisees</option>
            {franchiseesList.map(o => <option key={o.ncode} value={o.ncode}>{o.vcompanyname} ({o.call_count || 0})</option>)}
          </select>
        </div>

        {/* 7. Technician Cascading Dropdown */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Technician</label>
            {loading && <span className="w-2.5 h-2.5 border border-teal-655 border-t-transparent rounded-full animate-spin" />}
          </div>
          <select 
            value={selectedTechnician} 
            onChange={e => setSelectedTechnician(e.target.value)}
            disabled={loadingMeta || loading}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer disabled:opacity-60"
          >
            <option value="All">All Technicians</option>
            {techniciansList.map(t => <option key={t.ncode} value={t.ncode}>{t.vname} ({t.call_count || 0})</option>)}
          </select>
        </div>

        {/* 8. Call Type Dropdown */}
        <div className="space-y-1.5">
          <label className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold block">Call Type</label>
          <select 
            value={selectedCallType} 
            onChange={e => setSelectedCallType(e.target.value)}
            disabled={loadingMeta}
            className="w-full bg-white border border-slate-250 rounded-lg px-2.5 py-2 text-xs text-teal-655 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 shadow-sm cursor-pointer font-bold disabled:opacity-60"
          >
            <option value="All">All Call Types</option>
            {callTypesList.map(c => <option key={c.ncode} value={c.vdisplayvalue}>{c.vdisplayvalue}</option>)}
          </select>
        </div>

      </section>

      {/* Main UI Layout Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* Left Side: Call Distribution Map */}
        <div className="w-full lg:w-1/2 h-[350px] lg:h-full relative border-r border-slate-200/80 bg-slate-50 flex-shrink-0">
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
          
          {/* Stat Cards Row */}
          <div className="p-6 grid grid-cols-2 xl:grid-cols-4 gap-4 flex-shrink-0 border-b border-slate-100 bg-slate-50/20">
            
            {/* KPI 1: Total Calls */}
            <div className="p-4 bg-white border border-slate-200/80 rounded-xl relative overflow-hidden shadow-sm hover:shadow transition-all duration-200 group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Calls</p>
                  <h3 className="text-xl font-extrabold text-slate-900 mt-1">{loading ? '...' : metrics.totalCalls}</h3>
                </div>
                <span className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-500">
                  <SlidersHorizontal size={14} />
                </span>
              </div>
            </div>

            {/* KPI 2: Assigned Open */}
            <div className="p-4 bg-white border border-slate-200/80 rounded-xl relative overflow-hidden shadow-sm hover:shadow transition-all duration-200 group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Open Backlog</p>
                  <h3 className="text-xl font-extrabold text-amber-600 mt-1">{loading ? '...' : metrics.openCalls}</h3>
                </div>
                <span className="p-2 rounded-lg bg-amber-50 border border-amber-100 text-amber-600">
                  <AlertTriangle size={14} />
                </span>
              </div>
            </div>

            {/* KPI 3: Manpower Counts */}
            <div className="p-4 bg-white border border-slate-200/80 rounded-xl relative overflow-hidden shadow-sm hover:shadow transition-all duration-200 group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ASPs / Techs</p>
                  <h3 className="text-xl font-extrabold text-teal-700 mt-1">
                    {loading ? '...' : `${metrics.franchiseesCount} / ${metrics.activeTechniciansCount}`}
                  </h3>
                </div>
                <span className="p-2 rounded-lg bg-teal-50 border border-teal-100 text-teal-600">
                  <Users size={14} />
                </span>
              </div>
            </div>

            {/* KPI 4: Global Load Ratio */}
            <div className="p-4 bg-white border border-slate-200/80 rounded-xl relative overflow-hidden shadow-sm hover:shadow transition-all duration-200 group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Calls / Tech Ratio</p>
                  <h3 className="text-xl font-extrabold text-slate-900 mt-1">
                    {loading ? '...' : `${metrics.callToTechnicianRatio}x`}
                  </h3>
                </div>
                <span className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-500">
                  <MapPin size={14} />
                </span>
              </div>
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
              <Link
                href="/report"
                className="text-[10px] font-extrabold text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1.5 rounded-lg hover:bg-teal-100 transition-all flex items-center gap-1 active:scale-98 shadow-sm cursor-pointer"
              >
                View Detailed Register →
              </Link>
            </div>

            {/* Scrollable Table Wrapper */}
            <div className="flex-1 overflow-auto border border-slate-200 rounded-xl bg-white shadow-sm relative custom-scrollbar">
              
              {loading ? (
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

    </div>
  );
}
