'use client';

import React, { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '@/lib/supabase';
import axios from 'axios';
import {
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  X
} from 'lucide-react';
import { toast } from 'sonner';

export default function ReportPage() {
  const [activeTab, setActiveTab] = useState<'register' | 'summary' | 'accounts'>('register');
  const [data, setData] = useState<any[]>([]);
  const [summaryData, setSummaryData] = useState<any[]>([]);
  const [accountsData, setAccountsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [search, setSearch] = useState('');
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>([]);
  const [showOfficeDropdown, setShowOfficeDropdown] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedBranchEngs, setSelectedBranchEngs] = useState<string[]>([]);
  const [showEngPopup, setShowEngPopup] = useState<string | null>(null);
  const [fetchingEngs, setFetchingEngs] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filterRegion, setFilterRegion] = useState<string[]>([]); // Array for multiselect
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [filterAccount, setFilterAccount] = useState('All');
  const [selectedCallType, setSelectedCallType] = useState('All');
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [showCallTypeDropdown, setShowCallTypeDropdown] = useState(false);
  const [exportingDetailed, setExportingDetailed] = useState(false);
  const [agingAsOf, setAgingAsOf] = useState(new Date().toISOString().split('T')[0]);
  const [officeSearch, setOfficeSearch] = useState('');
  const [drillDown, setDrillDown] = useState<{
    isOpen: boolean;
    loading: boolean;
    data: any[];
    sql: string;
    type: string;
    title: string;
    params: any;
  }>({
    isOpen: false,
    loading: false,
    data: [],
    sql: '',
    type: '',
    title: '',
    params: null
  });
  const fetchControllerRef = React.useRef<AbortController | null>(null);
  const drillDownControllerRef = React.useRef<AbortController | null>(null);

  // Auto-sync agingAsOf with dateRange.end if it falls behind
  useEffect(() => {
    if (dateRange.end && agingAsOf) {
      const endD = new Date(dateRange.end);
      const agingD = new Date(agingAsOf);
      if (agingD < endD) {
        setAgingAsOf(dateRange.end);
      }
    }
  }, [dateRange.end, agingAsOf]);

  useEffect(() => {
    async function fetchOffices() {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Authorization': `Bearer ${session?.access_token}` };

      const [officeRes, typesRes] = await Promise.all([
        axios.get('/api/offices', { headers }),
        axios.get('/api/report/call-types', { headers })
      ]);

      setOffices(officeRes.data || []);
      setCallTypes(typesRes.data || []);
    }
    fetchOffices();
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';

    // Handle DD/MM/YYYY with optional time
    if (typeof dateStr === 'string' && dateStr.includes('/') && dateStr.split('/')[0].length <= 2) {
      const parts = dateStr.split(' ')[0].split('/');
      if (parts.length === 3) {
        const [d, m, y] = parts;
        const date = new Date(`${y}-${m}-${d}`);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      }
    }

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Return raw if still invalid, might be a string already
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const fetchData = async (p = 1) => {
    // Cancel previous request if it's still running
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setLoading(true);
    const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Authorization': `Bearer ${session?.access_token}`,
      };

      // Register data URL
      let url = `/api/report?page=${p}&limit=${limit}&officeId=${officeIdsParam}&callType=${selectedCallType}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (dateRange.start) url += `&startDate=${dateRange.start}`;
      if (dateRange.end) url += `&endDate=${dateRange.end}`;

      // Fetch summary only on the first page load or full refresh
      const needsSummary = p === 1;
      let summaryUrl = '';
      if (needsSummary) {
        summaryUrl = `/api/report/summary?officeId=${officeIdsParam}&callType=${selectedCallType}`;
        if (dateRange.start) summaryUrl += `&startDate=${dateRange.start}`;
        if (dateRange.end) summaryUrl += `&endDate=${dateRange.end}`;
        if (agingAsOf) summaryUrl += `&agingAsOf=${agingAsOf}`;
      }

      // Execute in parallel if summary needed
      if (needsSummary) {
        const [regRes, summRes] = await Promise.all([
          axios.get(url, { headers, signal: controller.signal }),
          axios.get(summaryUrl, { headers, signal: controller.signal })
        ]);

        setData(regRes.data.data);
        setTotal(regRes.data.total);
        setPage(p);

        setSummaryData(summRes.data.branchSummary);
        setAccountsData(summRes.data.accountSummary);
      } else {
        const regRes = await axios.get(url, { headers, signal: controller.signal });
        setData(regRes.data.data);
        setTotal(regRes.data.total);
        setPage(p);
      }
    } catch (err: any) {
      if (axios.isCancel(err)) {
        return; // Silently handle cancellation
      }
      toast.error("Failed to fetch report data");
    } finally {
      // Only set loading to false if this was the last request
      if (fetchControllerRef.current === controller) {
        setLoading(false);
        setLastRefreshed(new Date());
      }
    }
  };

  const handleDrillDown = async (type: string, title: string, params: any) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, isOpen: true, loading: true, type, title, params, data: [], sql: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post('/api/report/drilldown', {
        type,
        ...params,
        startDate: dateRange.start,
        endDate: dateRange.end
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      toast.error('Failed to fetch details');
      setDrillDown(prev => ({ ...prev, loading: false }));
    }
  };

  const runCustomQuery = async (customSql: string) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, loading: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post('/api/report/drilldown', {
        customQuery: customSql
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      toast.error('Query Error: ' + (err.response?.data?.error || err.message));
      setDrillDown(prev => ({ ...prev, loading: false }));
    }
  };
  ;

  const fetchEngineers = async (branch: string) => {
    setFetchingEngs(true);
    setShowEngPopup(branch);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let url = `/api/report/engineers?branch=${encodeURIComponent(branch)}`;
      if (dateRange.start) url += `&startDate=${dateRange.start}`;
      if (dateRange.end) url += `&endDate=${dateRange.end}`;

      const res = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setSelectedBranchEngs(res.data);
    } catch (err) {
      toast.error("Failed to fetch engineer names");
    } finally {
      setFetchingEngs(false);
    }
  };

  // Automatically fetch data when filters change
  useEffect(() => {
    fetchData(1);
  }, [dateRange.start, dateRange.end, selectedOfficeIds, filterAccount, selectedCallType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(1);
  };

  const handleExportDetailed = async (format: 'excel' | 'csv' = 'excel') => {
    setExportingDetailed(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Authorization': `Bearer ${session?.access_token}` };

      const res = await axios.get('/api/report', {
        headers,
        params: {
          page: 1,
          limit: 100000,
          officeId: selectedOfficeIds.length ? selectedOfficeIds.join(',') : 'All',
          callType: selectedCallType,
          startDate: dateRange.start,
          endDate: dateRange.end,
          ...(activeTab === 'accounts' ? {
            account: filterAccount,
            region: filterRegion.length ? filterRegion.join(',') : undefined
          } : {})
        }
      });

      const rawData = res.data?.data || [];
      if (rawData.length === 0) {
        alert("No data to export");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Detailed Breakdown');
      const fileName = `WRL_Detailed_Breakdown_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;

      sheet.columns = [
        { header: 'Reference', key: 'ref', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Location', key: 'location', width: 20 },
        { header: 'Product', key: 'product', width: 20 },
        { header: 'Serial', key: 'serial', width: 15 },
        { header: 'Technician', key: 'tech', width: 20 },
        { header: 'Complaint', key: 'complaint', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Priority', key: 'priority', width: 10 },
        { header: 'Solved Date', key: 'solvedDate', width: 12 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
      ];

      sheet.getRow(1).eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      rawData.forEach((row: any) => {
        const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
        const isAssigned = row.Status === 'Assigned' || row.callstatus === 'Assigned';
        const statusText = row.Status === 'UNKNOWN' ? 'PENDING' : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          ref: row.callsntrnno,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          location: row.vlocation,
          product: row.itemname,
          serial: row.callsvserialno,
          tech: row.serviceman,
          complaint: row.vcomplaint,
          status: statusText,
          priority: row.Priority,
          solvedDate: formatDate(row.callsolveddate),
          remarks: row.vsolveremarks,
          branch: row.officename
        });

        if (isSolved) {
          r.getCell('status').font = { color: { argb: 'FF10B981' }, bold: true };
        } else if (isAssigned) {
          r.getCell('status').font = { color: { argb: 'FFF59E0B' }, bold: true };
        } else {
          r.getCell('status').font = { color: { argb: 'FFEF4444' }, bold: true };
        }
      });

      let buffer;
      let mimeType;
      if (format === 'csv') {
        buffer = await workbook.csv.writeBuffer();
        mimeType = 'text/csv;charset=utf-8;';
      } else {
        buffer = await workbook.xlsx.writeBuffer();
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }

      const blob = new Blob([buffer], { type: mimeType });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

    } catch (err) {
      console.error("Failed to export detailed breakdown:", err);
      alert("Failed to export detailed breakdown");
    } finally {
      setExportingDetailed(false);
    }
  };


  const handleExport = async (format: 'excel' | 'csv' = 'excel') => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    let fileName = `WRL_MIS_Report_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    const getRegionColor = (region: string) => {
      const r = (region || '').toUpperCase();
      if (r.includes('NORTH')) return 'FFC6E0B4';
      if (r.includes('EAST')) return 'FFBDD7EE';
      if (r.includes('WEST')) return 'FFF8CBAD';
      if (r.includes('SOUTH')) return 'FFD9D9D9';
      return 'FFF1F5F9';
    };

    const applyHeaderStyle = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    };

    if (activeTab === 'register') {
      sheet.columns = [
        { header: 'Reference', key: 'ref', width: 15 },
        { header: 'Call Type', key: 'type', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Location', key: 'location', width: 20 },
        { header: 'Product', key: 'product', width: 20 },
        { header: 'Serial', key: 'serial', width: 15 },
        { header: 'Technician', key: 'tech', width: 20 },
        { header: 'Complaint', key: 'complaint', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Priority', key: 'priority', width: 10 },
        { header: 'Solved Date', key: 'solvedDate', width: 12 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
      ];

      applyHeaderStyle(sheet.getRow(1));

      let exportData = data;
      // For Call Register, if there's more than one page, fetch everything for export
      if (activeTab === 'register' && total > limit) {
        setExportingDetailed(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const headers = { 'Authorization': `Bearer ${session?.access_token}` };
          const params = new URLSearchParams({
            officeId: selectedOfficeIds.join(',') || 'All',
            callType: selectedCallType,
            startDate: dateRange.start,
            endDate: dateRange.end,
            limit: '20000', // Fetch a large batch for export
            page: '1'
          });
          const res = await axios.get(`/api/report?${params}`, { headers });
          exportData = res.data.data || [];
        } catch (err) {
          console.error("Full data fetch failed:", err);
          // Fallback to current page data
        } finally {
          setExportingDetailed(false);
        }
      }

      exportData.forEach(row => {
        const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
        const isAssigned = row.Status === 'Assigned' || row.callstatus === 'Assigned';
        const statusText = row.Status === 'UNKNOWN' ? 'PENDING' : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          ref: row.callsntrnno,
          type: row.calltype,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          location: row.vlocation,
          product: row.itemname,
          serial: row.callsvserialno,
          tech: row.serviceman,
          complaint: row.vcomplaint,
          status: statusText,
          priority: row.Priority,
          solvedDate: formatDate(row.callsolveddate),
          remarks: row.vsolveremarks,
          branch: row.officename
        });

        // Style status cell
        const statusCell = r.getCell('status');
        statusCell.font = { bold: true, color: { argb: isSolved ? 'FF059669' : isAssigned ? 'FF1D4ED8' : 'FF64748B' } };
        if (isSolved || isAssigned) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isSolved ? 'FFF8FAFC' : 'FFE8F0FE' } };
        }
      });

    } else if (activeTab === 'summary') {
      const regions = Array.from(new Set(summaryData.map(b => b.region))).sort();
      const topLevelBranches = summaryData.filter(b => b.parentId === 0 || !summaryData.find(p => p.officeId === b.parentId));

      const getAggregate = (item: any, key: string, regionBranches: any[]) => {
        const getAllChildren = (id: number): any[] => {
          let direct = regionBranches.filter(b => b.parentId === id);
          let all = [...direct];
          direct.forEach(d => { all = [...all, ...getAllChildren(d.officeId)]; });
          return all;
        };
        const allDescendants = getAllChildren(item.officeId);
        return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
      };

      // 1. Regional Performance
      sheet.addRow(['Regional Performance']).font = { bold: true, size: 12 };
      const regHeader = sheet.addRow(['Region', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(regHeader);

      regions.forEach(region => {
        const rb = summaryData.filter(b => b.region === region);
        const t = rb.reduce((acc, b) => ({
          t: acc.t + Number(b.total_calls || 0), s: acc.s + Number(b.solved_calls || 0), c: acc.c + Number(b.cancelled_calls || 0), o: acc.o + Number(b.open_calls || 0),
          a2: acc.a2 + Number(b.age_2 || 0), a3: acc.a3 + Number(b.age_3 || 0), a7: acc.a7 + Number(b.age_7 || 0), a15: acc.a15 + Number(b.age_15 || 0),
          p: acc.p + Number(b.part_pending || 0), e: acc.e + Number(b.active_eng || 0)
        }), { t: 0, s: 0, c: 0, o: 0, a2: 0, a3: 0, a7: 0, a15: 0, p: 0, e: 0 });

        const r = sheet.addRow([region, t.t, t.s, t.c, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(3).font = { color: { argb: 'FF059669' } };
        r.getCell(4).font = { color: { argb: 'FFDC2626' } };
        r.getCell(5).font = { bold: true };
      });

      // AI Total
      const aiRow = sheet.addRow([
        'AI TOTAL',
        summaryData.reduce((s, b) => s + Number(b.total_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.solved_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.cancelled_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.open_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_2 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_3 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_7 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_15 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.part_pending || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.active_eng || 0), 0)
      ]);
      aiRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      sheet.addRow([]); // Gap

      // 2. Branch Wise Performance
      sheet.addRow(['Branch Wise Performance']).font = { bold: true, size: 12 };
      const brHeader = sheet.addRow(['Branch', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(brHeader);

      topLevelBranches
        .sort((a, b) => a.region.localeCompare(b.region))
        .forEach(b => {
          const rb = summaryData.filter(x => x.region === b.region);
          const r = sheet.addRow([
            b.branch,
            getAggregate(b, 'total_calls', rb),
            getAggregate(b, 'solved_calls', rb),
            getAggregate(b, 'cancelled_calls', rb),
            getAggregate(b, 'open_calls', rb),
            getAggregate(b, 'age_2', rb),
            getAggregate(b, 'age_3', rb),
            getAggregate(b, 'age_7', rb),
            getAggregate(b, 'age_15', rb),
            getAggregate(b, 'part_pending', rb),
            getAggregate(b, 'active_eng', rb)
          ]);
          r.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(b.region) } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          });
          r.getCell(3).font = { color: { argb: 'FF059669' } };
          r.getCell(4).font = { color: { argb: 'FFDC2626' } };
          r.getCell(5).font = { bold: true };
        });

    } else {
      // Key Account MIS
      const filtered = accountsData.filter(a => {
        const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
        const matchAccount = filterAccount === 'All' || a.account.toLowerCase().includes(filterAccount.toLowerCase());
        return matchRegion && matchAccount;
      }).sort((a, b) => a.region.localeCompare(b.region));

      const kaHeader = sheet.addRow(['Region', 'Account', 'Population', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(kaHeader);

      filtered.forEach(a => {
        const openCalls = Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0);
        const r = sheet.addRow([
          a.region, a.account, a.population || 0, a.total_calls, a.total_solved, a.cancelled_calls, openCalls,
          a.age_2, a.age_3, a.age_7, a.age_15, a.part_pending, a.active_eng
        ]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(a.region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(5).font = { color: { argb: 'FF059669' } };
        r.getCell(6).font = { color: { argb: 'FFDC2626' } };
        r.getCell(7).font = { bold: true };
      });
    }

    let buffer;
    let mimeType;
    if (format === 'csv') {
      buffer = await workbook.csv.writeBuffer();
      mimeType = 'text/csv;charset=utf-8;';
    } else {
      buffer = await workbook.xlsx.writeBuffer();
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex flex-col h-screen bg-white font-sans overflow-hidden text-slate-900">
      {/* Top Header */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="text-slate-900" size={18} />
          <h1 className="text-sm font-semibold tracking-tight">MIS Reports</h1>
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-medium uppercase tracking-wider">BD & Deployment</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex">
            {[
              { id: 'register', label: 'Call Register' },
              { id: 'summary', label: 'Summary Dashboard' },
              { id: 'accounts', label: 'Key Account MIS' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 h-14 text-xs font-medium transition-all relative ${activeTab === tab.id
                  ? 'text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-[10px] text-slate-400 font-medium">
              Last Refreshed: {lastRefreshed?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => fetchData(1)}
            disabled={loading}
            className="flex items-center gap-2 bg-white text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
          >
            <div className={`${loading ? 'animate-spin' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
            </div>
            Refresh
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 bg-white text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
          >
            <FileSpreadsheet size={14} className="text-emerald-600" />
            Excel Export
          </button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-4 flex-wrap lg:flex-nowrap flex-shrink-0">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Filter records..."
            className="w-full bg-white border border-slate-200 rounded-md py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <div className="flex items-center gap-4 ml-auto">
          {/* Call Type Filter — only for Call Register tab */}
          {activeTab === 'register' && (
            <div className="relative">
              <button
                onClick={() => setShowCallTypeDropdown(!showCallTypeDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-700 hover:border-slate-400 transition-all shadow-sm min-w-[140px]"
              >
                <span className="flex-1 text-left truncate">
                  {selectedCallType === 'All' ? 'All Call Types' : selectedCallType}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCallTypeDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showCallTypeDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowCallTypeDropdown(false)}
                  />
                  <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-lg z-50 py-1 max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Call Type</span>
                    </div>
                    {['All', ...callTypes].map(type => (
                      <button
                        key={type}
                        onClick={() => {
                          setSelectedCallType(type);
                          setShowCallTypeDropdown(false);
                          setPage(1);
                        }}
                        className={`w-full text-left px-4 py-2 text-[11px] hover:bg-slate-50 transition-colors font-medium ${selectedCallType === type ? 'text-blue-600 bg-blue-50/50 font-bold' : 'text-slate-600'
                          }`}
                      >
                        {type === 'All' ? 'All Call Types' : type}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {/* Branch Filter */}
            <div className="relative">
              <button
                onClick={() => setShowOfficeDropdown(!showOfficeDropdown)}
                className="min-w-[140px] max-w-[200px] bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs font-bold text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all shadow-sm"
              >
                <span className="truncate">
                  {selectedOfficeIds.length === 0 ? 'All Branches' : `${selectedOfficeIds.length} Selected`}
                </span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${showOfficeDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showOfficeDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOfficeDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Branches</span>
                      <button
                        onClick={() => { setSelectedOfficeIds([]); setOfficeSearch(''); }}
                        className="text-[10px] font-bold text-slate-400 hover:text-slate-900 px-2 py-1 rounded hover:bg-white"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search branches..."
                          className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                          value={officeSearch}
                          onChange={(e) => setOfficeSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1 custom-scrollbar">
                      {officeSearch ? (
                        offices.filter(o => o.vcompanyname.toLowerCase().includes(officeSearch.toLowerCase())).map(o => {
                          const isSelected = selectedOfficeIds.includes(String(o.ncode));
                          return (
                            <label key={o.ncode} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                checked={isSelected}
                                onChange={(e) => {
                                  const val = String(o.ncode);
                                  if (e.target.checked) {
                                    setSelectedOfficeIds(prev => Array.from(new Set([...prev, val])));
                                  } else {
                                    setSelectedOfficeIds(prev => prev.filter(id => id !== val));
                                  }
                                }}
                              />
                              <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
                                {o.vcompanyname}
                              </span>
                            </label>
                          );
                        })
                      ) : ((() => {
                        const buildTree = (parentId: string | null = '0', level = 0): React.ReactNode[] => {
                          return offices
                            .filter(o => String(o.nunder || '0') === String(parentId || '0'))
                            .map(o => {
                              const isSelected = selectedOfficeIds.includes(String(o.ncode));
                              return [
                                <label key={o.ncode} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                                  <div style={{ width: `${level * 12}px` }} />
                                  <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      const val = String(o.ncode);
                                      if (e.target.checked) {
                                        // Add this and all descendants
                                        const getAllChildren = (id: string): string[] => {
                                          const children = offices.filter(c => String(c.nunder) === String(id));
                                          let ids = [id];
                                          children.forEach(c => {
                                            ids = [...ids, ...getAllChildren(String(c.ncode))];
                                          });
                                          return ids;
                                        };
                                        const allToAdd = getAllChildren(val);
                                        setSelectedOfficeIds(prev => Array.from(new Set([...prev, ...allToAdd])));
                                      } else {
                                        // Remove this and all descendants
                                        const getAllChildren = (id: string): string[] => {
                                          const children = offices.filter(c => String(c.nunder) === String(id));
                                          let ids = [id];
                                          children.forEach(c => {
                                            ids = [...ids, ...getAllChildren(String(c.ncode))];
                                          });
                                          return ids;
                                        };
                                        const allToRemove = getAllChildren(val);
                                        setSelectedOfficeIds(prev => prev.filter(id => !allToRemove.includes(id)));
                                      }
                                    }}
                                  />
                                  <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
                                    {o.vcompanyname}
                                  </span>
                                </label>,
                                ...buildTree(o.ncode, level + 1)
                              ];
                            }).flat();
                        };
                        return buildTree('0', 0);
                      })())}
                    </div>
                    <div className="p-2 border-t border-slate-100 bg-slate-50 flex justify-end">
                      <button
                        onClick={() => setShowOfficeDropdown(false)}
                        className="bg-slate-900 text-white px-4 py-1 rounded text-[10px] font-bold hover:bg-slate-800 transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 border-l border-slate-200 pl-4 h-6">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</span>
              <input
                type="date"
                className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-all"
                value={dateRange.start}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">To</span>
              <input
                type="date"
                className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-all"
                value={dateRange.end}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              />
            </div>
          </div>

          {/* Aging As Of — only relevant on Summary/Accounts tabs */}
          {(activeTab === 'summary' || activeTab === 'accounts') && (
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4 h-6">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider whitespace-nowrap">Aging As Of</span>
              <input
                type="date"
                className="bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs font-bold text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-400 shadow-sm"
                value={agingAsOf}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setAgingAsOf(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-white relative custom-scrollbar">
        <style jsx global>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 0px;
            height: 0px;
            display: none;
          }
          .custom-scrollbar {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .inner-scrollbar::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .inner-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .inner-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 10px;
          }
          .inner-scrollbar:hover::-webkit-scrollbar-thumb {
            background: #94a3b8;
          }
        `}</style>
        <div className="h-full overflow-y-auto inner-scrollbar">
          {loading && (
            <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-50">
              <div className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg shadow-xl">
                <div className="w-3 h-3 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[11px] font-medium text-slate-900 uppercase tracking-widest">Loading...</p>
              </div>
            </div>
          )}

          {activeTab === 'register' ? (
            <table className="w-full text-left border-collapse min-w-[2400px]">
              <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase tracking-wider w-12 text-center border-r border-slate-100">#</th>
                  {[
                    { key: 'callsntrnno', label: 'Reference' },
                    { key: 'calltype', label: 'Call Type' },
                    { key: 'callsdtrndate', label: 'Date' },
                    { key: 'PartyName', label: 'Customer' },
                    { key: 'vlocation', label: 'Location' },
                    { key: 'itemname', label: 'Product' },
                    { key: 'callsvserialno', label: 'Serial' },
                    { key: 'serviceman', label: 'Technician' },
                    { key: 'vcomplaint', label: 'Complaint' },
                    { key: 'Status', label: 'Status' },
                    { key: 'Priority', label: 'Prio' },
                    { key: 'callsolveddate', label: 'Solved' },
                    { key: 'vsolveremarks', label: 'Remarks' },
                    { key: 'UniqueCallNo', label: 'ID' },
                    { key: 'vpersoncalling', label: 'Contact Person' },
                    { key: 'vinsttel1', label: 'Phone' },
                    { key: 'vinstaddress', label: 'Address' },
                    { key: 'addedby', label: 'User' },
                    { key: 'officename', label: 'Branch' }
                  ].map(col => (
                    <th key={col.key} className="px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase tracking-wider border-r border-slate-100 whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.length > 0 ? data.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2 text-[11px] text-slate-400 border-r border-slate-50 text-center">
                      {(page - 1) * limit + idx + 1}
                    </td>
                    <td className="px-4 py-2 text-[11px] font-medium text-slate-900 border-r border-slate-50 whitespace-nowrap">{row.callsntrnno}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-600 border border-slate-200">
                        {row.calltype || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap uppercase">
                      {formatDate(row.callsdtrndate)}
                    </td>
                    <td className="px-4 py-2 text-[11px] font-medium text-slate-800 border-r border-slate-50 max-w-[250px] truncate uppercase">{row.PartyName}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap uppercase">{row.vlocation}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 border-r border-slate-50 whitespace-nowrap uppercase">{row.itemname}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-slate-500 border-r border-slate-50 whitespace-nowrap">{row.callsvserialno}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-900 border-r border-slate-50 whitespace-nowrap uppercase">{row.serviceman}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 max-w-[200px] truncate uppercase">{row.vcomplaint}</td>
                    <td className="px-4 py-2 border-r border-slate-50 whitespace-nowrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${(row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True') ? 'bg-slate-50 text-slate-700 border-slate-200' :
                        (row.Status === 'Assigned' || row.callstatus === 'Assigned') ? 'bg-blue-50 text-blue-700 border-blue-100' :
                          'bg-slate-50 text-slate-500 border-slate-100'
                        }`}>
                        {row.Status === 'UNKNOWN' ? 'PENDING' : (row.Status || row.callstatus || 'OPEN')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-400 border-r border-slate-50 whitespace-nowrap uppercase">
                      {row.Priority}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap uppercase">
                      {formatDate(row.callsolveddate)}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-400 border-r border-slate-50 max-w-[300px] truncate uppercase">{row.vsolveremarks}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-slate-400 border-r border-slate-50">{row.UniqueCallNo}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-600 border-r border-slate-50 whitespace-nowrap uppercase">{row.vpersoncalling}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-900 border-r border-slate-50 whitespace-nowrap">{row.vinsttel1}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 max-w-[400px] truncate uppercase">{row.vinstaddress}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-400 border-r border-slate-50 uppercase">{row.addedby}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 border-r border-slate-50 uppercase">{row.officename}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={20} className="px-6 py-20 text-center">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">No matching records found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : activeTab === 'summary' ? (
            <div className="p-6 space-y-8">
              {/* Region Summary Table */}
              <section className="mb-8">
                <h2 className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wider px-2">Regional Performance (AI)</h2>
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0070c0] text-white font-bold uppercase tracking-tighter text-[10px]">
                        <th className="p-2 border border-slate-300">Region</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'<2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>3 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        const totals = regionBranches.reduce((acc, b) => ({
                          total: acc.total + Number(b.total_calls || 0),
                          solved: acc.solved + Number(b.solved_calls || 0),
                          cancelled: acc.cancelled + Number(b.cancelled_calls || 0),
                          open: acc.open + Number(b.open_calls || 0),
                          age2: acc.age2 + Number(b.age_2 || 0),
                          age3: acc.age3 + Number(b.age_3 || 0),
                          age7: acc.age7 + Number(b.age_7 || 0),
                          age15: acc.age15 + Number(b.age_15 || 0),
                          parts: acc.parts + Number(b.part_pending || 0),
                          engs: acc.engs + Number(b.active_eng || 0)
                        }), { total: 0, solved: 0, cancelled: 0, open: 0, age2: 0, age3: 0, age7: 0, age15: 0, parts: 0, engs: 0 });

                        const getRegionBg = (reg: string) => {
                          const r = reg.toUpperCase();
                          if (r.includes('NORTH')) return 'bg-[#c6e0b4]';
                          if (r.includes('EAST')) return 'bg-[#bdd7ee]';
                          if (r.includes('WEST')) return 'bg-[#f8cbad]';
                          if (r.includes('SOUTH')) return 'bg-[#d9d9d9]';
                          return 'bg-slate-100';
                        };

                        return (
                          <tr key={region} className={`${getRegionBg(region)} font-bold text-slate-900`}>
                            <td className="p-2 border border-slate-300 uppercase">{region}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${region} - Total Calls`, { region })}>{totals.total}</td>
                            <td className="p-2 border border-slate-300 text-center text-emerald-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${region} - Solved Calls`, { region })}>{totals.solved}</td>
                            <td className="p-2 border border-slate-300 text-center text-rose-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('cancelled_calls', `${region} - Cancelled Calls`, { region })}>{totals.cancelled}</td>
                            <td className="p-2 border border-slate-300 text-center font-bold bg-slate-100/50 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('open_calls', `${region} - Open Calls`, { region })}>{totals.open}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${region} - <2 Days`, { region })}>{totals.age2}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${region} - 2-7 Days`, { region })}>{totals.age3}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${region} - 7-15 Days`, { region })}>{totals.age7}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${region} - >15 Days`, { region })}>{totals.age15}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${region} - Part Pending`, { region })}>{totals.parts}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.engs}</td>
                          </tr>
                        );
                      })}
                      {/* All India Total Row */}
                      <tr className="bg-[#ffff00] font-bold text-slate-900">
                        <td className="p-2 border border-slate-300">AI</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.total_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center bg-slate-800/20">{summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Branch Summary Table */}
              <section>
                <h2 className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wider px-2">Branch Wise Performance</h2>
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0070c0] text-white font-bold uppercase tracking-tighter text-[10px]">
                        <th className="p-2 border border-slate-300 min-w-[200px]">Branches</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'<2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>3 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        if (regionBranches.length === 0) return null;

                        const topLevel = regionBranches.filter(b =>
                          b.parentId === 0 || !regionBranches.find(p => p.officeId === b.parentId)
                        ).sort((a, b) => Number(b.total_calls) - Number(a.total_calls));

                        const getRegionBg = (reg: string) => {
                          const r = reg.toUpperCase();
                          if (r.includes('NORTH')) return 'bg-[#c6e0b4]';
                          if (r.includes('EAST')) return 'bg-[#bdd7ee]';
                          if (r.includes('WEST')) return 'bg-[#f8cbad]';
                          if (r.includes('SOUTH')) return 'bg-[#d9d9d9]';
                          return 'bg-slate-100';
                        };

                        const bgClass = getRegionBg(region);

                        return (
                          <React.Fragment key={region}>
                            {topLevel.map(branch => {
                              const children = regionBranches.filter(b => b.parentId === branch.officeId);
                              const hasChildren = children.length > 0;
                              const isExpanded = expandedBranches[branch.officeId];

                              const getAggregate = (item: any, key: string) => {
                                const getAllChildren = (id: number): any[] => {
                                  let direct = regionBranches.filter(b => b.parentId === id);
                                  let all = [...direct];
                                  direct.forEach(d => {
                                    all = [...all, ...getAllChildren(d.officeId)];
                                  });
                                  return all;
                                };
                                const allDescendants = getAllChildren(item.officeId);
                                return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
                              };

                              return (
                                <React.Fragment key={branch.officeId}>
                                  <tr className={`${bgClass} hover:brightness-95 transition-all font-medium text-slate-900`}>
                                    <td className="p-2 border border-slate-300">
                                      <div className="flex items-center gap-1">
                                        {hasChildren ? (
                                          <button
                                            onClick={() => setExpandedBranches(prev => ({ ...prev, [branch.officeId]: !prev[branch.officeId] }))}
                                            className="p-0.5 hover:bg-white/50 rounded transition-all text-slate-700"
                                          >
                                            {isExpanded ? <ChevronDown size={12} strokeWidth={3} /> : <ChevronRight size={12} strokeWidth={3} />}
                                          </button>
                                        ) : (
                                          <div className="w-4" />
                                        )}
                                        <span className="truncate">{branch.branch}</span>
                                      </div>
                                    </td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${branch.branch} - Total Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'total_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${branch.branch} - Solved Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'solved_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('cancelled_calls', `${branch.branch} - Cancelled Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'cancelled_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center font-bold cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('open_calls', `${branch.branch} - Open Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'open_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${branch.branch} - <2 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_2')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${branch.branch} - 2-7 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_3')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${branch.branch} - 7-15 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_7')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${branch.branch} - >15 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_15')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${branch.branch} - Part Pending`, { officeId: branch.officeId })}>{getAggregate(branch, 'part_pending')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'active_eng')}</td>
                                  </tr>

                                  {isExpanded && children.map(child => (
                                    <tr key={child.officeId} className="bg-white/60 hover:bg-white transition-colors text-slate-600 italic">
                                      <td className="p-1.5 pl-8 border border-slate-300">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{child.branch}</span>
                                        </div>
                                      </td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${child.branch} - Total Calls`, { officeId: child.officeId })}>{child.total_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${child.branch} - Solved Calls`, { officeId: child.officeId })}>{child.solved_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] font-bold cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('open_calls', `${child.branch} - Open Calls`, { officeId: child.officeId })}>{child.open_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${child.branch} - <2 Days`, { officeId: child.officeId })}>{child.age_2}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${child.branch} - 2-7 Days`, { officeId: child.officeId })}>{child.age_3}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${child.branch} - 7-15 Days`, { officeId: child.officeId })}>{child.age_7}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${child.branch} - >15 Days`, { officeId: child.officeId })}>{child.age_15}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${child.branch} - Part Pending`, { officeId: child.officeId })}>{child.part_pending}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.active_eng}</td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {(() => {
                const filteredAccounts = accountsData.filter(a => {
                  const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
                  const matchAccount = filterAccount === 'All' || a.account.toLowerCase().includes(filterAccount.toLowerCase());
                  return matchRegion && matchAccount;
                });

                return (
                  <>
                    <div className="flex items-center justify-between px-2 mb-2">
                      <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Key Account Wise Performance</h2>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          {/* Category Headers */}
                          <tr className="bg-slate-800 text-white font-bold">
                            <th className="p-1.5 border border-slate-600" colSpan={3}>Basics</th>
                            <th className="p-1.5 border border-slate-600 text-center" colSpan={4}>Calls Summary (Breakdown)</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-blue-600" colSpan={7}>Breakdown (Aging)</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-amber-600" colSpan={3}>Deployment</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-emerald-600" colSpan={2}>Installation</th>
                          </tr>
                          <tr className="bg-slate-100 text-slate-700 font-bold">
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1 relative">
                                <span>Region</span>
                                <button
                                  onClick={() => setShowRegionDropdown(!showRegionDropdown)}
                                  className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[9px] font-bold text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all"
                                >
                                  <span className="truncate">
                                    {filterRegion.length === 0 ? 'All' : `${filterRegion.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showRegionDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowRegionDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                      <div className="p-1 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                        <button
                                          onClick={() => setFilterRegion([])}
                                          className="text-[9px] font-bold text-slate-400 hover:text-slate-900 px-1.5 py-0.5"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => setShowRegionDropdown(false)}
                                          className="text-[9px] font-bold text-slate-900 px-1.5 py-0.5"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(accountsData.map(a => a.region))).sort().map(r => (
                                          <label key={r} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={filterRegion.includes(r)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setFilterRegion([...filterRegion, r]);
                                                } else {
                                                  setFilterRegion(filterRegion.filter(x => x !== r));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-900 uppercase">{r}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1">
                                <span>Key Account</span>
                                <div className="relative">
                                  <input
                                    type="text"
                                    placeholder="Type to search..."
                                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[9px] font-medium text-slate-700 outline-none focus:ring-1 focus:ring-slate-400 pr-4"
                                    value={filterAccount === 'All' ? '' : filterAccount}
                                    onChange={(e) => setFilterAccount(e.target.value || 'All')}
                                  />
                                  {filterAccount !== 'All' && (
                                    <button
                                      onClick={() => setFilterAccount('All')}
                                      className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                      <X size={10} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Population</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total calls</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total solved</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Cancelled</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3"># open calls</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">&lt;2 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">2-7 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">7-15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">&gt;15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">% &gt;7 Days</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3">Part pending</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 font-black tracking-tighter align-bottom pb-3"># of active Eng.</th>

                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 font-black tracking-tighter">Total</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 font-black tracking-tighter">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 font-black tracking-tighter">Pending</th>

                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 font-black tracking-tighter">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 font-black tracking-tighter">Pending</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredAccounts.map((a, i) => {
                            const open_calls_sum = Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0);
                            const perc_gt_7 = open_calls_sum > 0 ? (((Number(a.age_7 || 0) + Number(a.age_15 || 0)) / open_calls_sum) * 100).toFixed(0) + '%' : '0%';
                            const dep_pending = Number(a.deployment_total || 0) - Number(a.deployment_done || 0);
                            const inst_pending = Number(a.installation_total || 0) - Number(a.installation_done || 0);

                            // Dynamic colors for regions
                            const regColor = a.region === 'NORTH' ? 'bg-green-50 text-green-700' :
                              a.region === 'EAST' ? 'bg-blue-50 text-blue-700' :
                                a.region === 'WEST' ? 'bg-amber-50 text-amber-700' :
                                  a.region === 'SOUTH' ? 'bg-purple-50 text-purple-700' : 'bg-slate-50 text-slate-700';

                            return (
                              <tr key={i} className="hover:bg-slate-50 transition-colors text-slate-900 border-b border-slate-200">
                                <td className={`p-1.5 border border-slate-300 font-bold ${regColor}`}>{a.region}</td>
                                <td className="p-1.5 border border-slate-300 font-medium uppercase text-[9px] bg-slate-50/30">{a.account}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-bold text-slate-500">{a.population || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${a.account} - Total Calls`, { account: a.account, region: a.region })}>{a.total_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_solved', `${a.account} - Solved Calls`, { account: a.account, region: a.region })}>{a.total_solved}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-rose-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('cancelled_calls', `${a.account} - Cancelled Calls`, { account: a.account, region: a.region })}>{a.cancelled_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-black text-slate-900 bg-slate-100/50 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('open_calls', `${a.account} - Open Calls`, { account: a.account, region: a.region })}>{open_calls_sum}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${a.account} - <2 Days`, { account: a.account, region: a.region })}>{a.age_2 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${a.account} - 2-7 Days`, { account: a.account, region: a.region })}>{a.age_3 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${a.account} - 7-15 Days`, { account: a.account, region: a.region })}>{a.age_7 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${a.account} - >15 Days`, { account: a.account, region: a.region })}>{a.age_15 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-bold text-blue-700 bg-blue-100/20">{perc_gt_7}</td>

                                <td className="p-1.5 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${a.account} - Part Pending`, { account: a.account, region: a.region })}>{a.part_pending || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center">{a.active_eng || 0}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-amber-50/30">{a.deployment_total || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-amber-50/30">{a.deployment_done || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-bold text-amber-700 bg-amber-100/20">{dep_pending}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-emerald-50/30">{a.installation_done || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-bold text-emerald-700 bg-emerald-100/20">{inst_pending}</td>
                              </tr>
                            );
                          })}

                          {/* Account Total Row */}
                          <tr className="bg-slate-900 text-white font-bold text-[10px]">
                            <td className="p-1.5 border border-slate-700" colSpan={2}>GRAND TOTAL (AI)</td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.population || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('total_calls', `All India - Total Calls`, { account: filterAccount || 'All India', region: 'AI' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('total_solved', `All India - Solved Calls`, { account: filterAccount || 'All India', region: 'AI' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_solved || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-rose-400 cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('cancelled_calls', `All India - Cancelled Calls`, { account: filterAccount || 'All India', region: 'AI' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.cancelled_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center bg-slate-800 cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('open_calls', `All India - Open Calls`, { account: filterAccount || 'All India', region: 'AI' })}>
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0)), 0).toLocaleString()}
                            </td>

                            {/* Aging Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_2 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_3 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_7 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_15 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {(() => {
                                const t7 = filteredAccounts.reduce((sum, a) => sum + Number(a.age_7 || 0), 0);
                                const t15 = filteredAccounts.reduce((sum, a) => sum + Number(a.age_15 || 0), 0);
                                const topen = filteredAccounts.reduce((sum, a) => sum + (Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0)), 0);
                                return topen > 0 ? ((t7 + t15) / topen * 100).toFixed(0) + '%' : '0%';
                              })()}
                            </td>

                            {/* Support Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.part_pending || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.active_eng || 0), 0).toLocaleString()}
                            </td>

                            {/* Deployment Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_total || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-amber-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.deployment_total || 0) - Number(a.deployment_done || 0)), 0).toLocaleString()}
                            </td>

                            {/* Installation Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.installation_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-emerald-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.installation_total || 0) - Number(a.installation_done || 0)), 0).toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Pagination Footer */}
      {activeTab === 'register' && (
        <div className="h-12 bg-white border-t border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
          <div className="text-[11px] font-medium text-slate-400">
            Showing {data.length} of {total.toLocaleString()} records
          </div>

          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => fetchData(page - 1)}
              className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-20 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-[11px] font-medium text-slate-900 min-w-[60px] text-center">
              Page {page} of {totalPages || 1}
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => fetchData(page + 1)}
              className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-20 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Engineer Popup */}
      {showEngPopup && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Engineer List</h3>
                <p className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">{showEngPopup}</p>
              </div>
              <button
                onClick={() => setShowEngPopup(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <ChevronLeft className="rotate-180" size={18} />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2">
              {fetchingEngs ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fetching Names...</p>
                </div>
              ) : selectedBranchEngs.length > 0 ? (
                <div className="grid grid-cols-1 gap-1">
                  {selectedBranchEngs.map((name, i) => (
                    <div key={i} className="px-3 py-2 text-[11px] font-medium text-slate-700 bg-slate-50/50 rounded-lg border border-slate-100/50 hover:border-slate-200 hover:bg-white transition-all uppercase">
                      {name}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  No engineers found
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowEngPopup(null)}
                className="px-4 py-1.5 bg-slate-900 text-white text-[10px] font-bold rounded-lg uppercase tracking-widest hover:bg-slate-800 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill Down Side Panel */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[200] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} />
          <div className="relative w-full max-w-5xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">{drillDown.title}</h3>
                <p className="text-[10px] text-slate-500 font-medium">Detailed breakdown of selected metric</p>
              </div>
              <button onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* SQL Query Runner */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Search size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">SQL Query Context</span>
                  </div>
                  <button
                    onClick={() => runCustomQuery(drillDown.sql)}
                    className="px-3 py-1 bg-slate-900 text-white rounded text-[10px] font-bold uppercase hover:bg-slate-800 transition-all flex items-center gap-2"
                  >
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    Run Custom Query
                  </button>
                </div>
                <div className="relative group">
                  <textarea
                    className="w-full h-32 p-3 font-mono text-[11px] bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all"
                    value={drillDown.sql}
                    onChange={(e) => setDrillDown(prev => ({ ...prev, sql: e.target.value }))}
                  />
                </div>
              </div>

              {/* Results */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                    Detail Records
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full text-[9px] font-black">{drillDown.data.length} Results</span>
                  </h4>
                  {drillDown.data.length > 0 && (
                    <button className="text-[10px] font-bold text-blue-600 hover:underline uppercase">Export Details</button>
                  )}
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                        <tr>
                          {drillDown.data.length > 0 && Object.keys(drillDown.data[0]).map(key => (
                            <th key={key} className="p-3 font-bold text-slate-500 uppercase tracking-wider border-r border-slate-100 whitespace-nowrap">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drillDown.loading ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Executing Query...</p>
                              </div>
                            </td>
                          </tr>
                        ) : drillDown.data.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">No data available for this metric</p>
                            </td>
                          </tr>
                        ) : (
                          drillDown.data.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors group">
                              {Object.values(row).map((val: any, j) => (
                                <td key={j} className="p-3 border-r border-slate-50 whitespace-nowrap text-slate-600 group-hover:text-slate-900 font-medium uppercase truncate max-w-[200px]">
                                  {String(val || '—')}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
