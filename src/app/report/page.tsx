'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import axios from 'axios';
import {
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
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
  const [selectedOfficeId, setSelectedOfficeId] = useState('All');
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedBranchEngs, setSelectedBranchEngs] = useState<string[]>([]);
  const [showEngPopup, setShowEngPopup] = useState<string | null>(null);
  const [fetchingEngs, setFetchingEngs] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filterRegion, setFilterRegion] = useState('All');
  const [filterAccount, setFilterAccount] = useState('All');

  useEffect(() => {
    async function fetchOffices() {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.get('/api/offices', {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setOffices(res.data || []);
    }
    fetchOffices();
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';

    // Handle DD/MM/YYYY
    if (typeof dateStr === 'string' && dateStr.includes('/') && dateStr.split('/')[0].length <= 2) {
      const [d, m, y] = dateStr.split('/');
      const date = new Date(`${y}-${m}-${d}`);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Return raw if still invalid, might be a string already
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }; const fetchData = async (p = 1) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Authorization': `Bearer ${session?.access_token}` };

      // Register data URL
      let url = `/api/report?page=${p}&limit=${limit}&officeId=${selectedOfficeId}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (dateRange.start) url += `&startDate=${dateRange.start}`;
      if (dateRange.end) url += `&endDate=${dateRange.end}`;

      // Fetch summary only on the first page load or full refresh
      const needsSummary = p === 1;
      let summaryUrl = '';
      if (needsSummary) {
        summaryUrl = `/api/report/summary?officeId=${selectedOfficeId}`;
        if (dateRange.start) summaryUrl += `&startDate=${dateRange.start}`;
        if (dateRange.end) summaryUrl += `&endDate=${dateRange.end}`;
      }

      // Execute in parallel if summary needed
      if (needsSummary) {
        const [regRes, summRes] = await Promise.all([
          axios.get(url, { headers }),
          axios.get(summaryUrl, { headers })
        ]);

        setData(regRes.data.data);
        setTotal(regRes.data.total);
        setPage(p);

        setSummaryData(summRes.data.branchSummary);
        setAccountsData(summRes.data.accountSummary);
      } else {
        const regRes = await axios.get(url, { headers });
        setData(regRes.data.data);
        setTotal(regRes.data.total);
        setPage(p);
      }
    } catch (err: any) {
      toast.error("Failed to fetch report data");
    } finally {
      setLoading(false);
      setLastRefreshed(new Date());
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

  useEffect(() => {
    fetchData(1);
  }, []); // Only load once on mount. Subsequent refreshes are manual via the Refresh button.

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(1);
  };

  const exportToCSV = () => {
    if (data.length === 0) return;

    const columnMapping: Record<string, string> = {
      'callsntrnno': 'Reference',
      'callsdtrndate': 'Date',
      'PartyName': 'Customer',
      'vlocation': 'Location',
      'itemname': 'Product',
      'callsvserialno': 'Serial',
      'serviceman': 'Technician',
      'vcomplaint': 'Complaint',
      'Status': 'Status',
      'Priority': 'Priority',
      'callsolveddate': 'Solved Date',
      'vsolveremarks': 'Remarks',
      'UniqueCallNo': 'Call ID',
      'vpersoncalling': 'Contact Person',
      'vinsttel1': 'Phone',
      'vinstaddress': 'Address',
      'addedby': 'User',
      'officename': 'Branch'
    };

    const headers = Object.keys(columnMapping);
    const readableHeaders = Object.values(columnMapping);

    const csvContent = [
      readableHeaders.join(','),
      ...data.map(row => headers.map(h => {
        let val = row[h] || '';
        if (h === 'callsdtrndate' || h === 'callsolveddate') {
          val = val ? new Date(val).toLocaleDateString('en-GB') : '';
        }
        if (h === 'Status' && val === 'UNKNOWN') val = 'PENDING';
        return `"${val.toString().replace(/"/g, '""')}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `WRL_MIS_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              Last Refreshed: {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-white text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Download size={14} />
            Export CSV
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
          <div className="flex items-center gap-2">
            <select
              className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:ring-1 focus:ring-slate-400"
              value={selectedOfficeId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'All') {
                  setSelectedOfficeId('All');
                } else {
                  // Find all children recursively
                  const getAllChildren = (id: string): string[] => {
                    const children = offices.filter(o => String(o.nunder) === String(id));
                    let ids = [id];
                    children.forEach(c => {
                      ids = [...ids, ...getAllChildren(String(c.ncode))];
                    });
                    return ids;
                  };
                  const allIds = getAllChildren(val);
                  setSelectedOfficeId(allIds.join(','));
                }
              }}
            >
              <option value="All">All Branches</option>
              {(() => {
                const buildTree = (parentId: string | null = '0', level = 0): React.ReactNode[] => {
                  return offices
                    .filter(o => String(o.nunder || '0') === String(parentId || '0'))
                    .map(o => [
                      <option key={o.ncode} value={o.ncode}>
                        {'\u00A0'.repeat(level * 4)}{o.vcompanyname}
                      </option>,
                      ...buildTree(o.ncode, level + 1)
                    ]).flat();
                };
                return buildTree('0', 0);
              })()}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <input
              type="date"
              className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-700"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            />
            <span className="text-slate-300">—</span>
            <input
              type="date"
              className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs font-medium text-slate-700"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            />
          </div>
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
                            <td className="p-2 border border-slate-300 text-center">{totals.total}</td>
                            <td className="p-2 border border-slate-300 text-center text-emerald-600">{totals.solved}</td>
                            <td className="p-2 border border-slate-300 text-center text-rose-600">{totals.cancelled}</td>
                            <td className="p-2 border border-slate-300 text-center font-bold bg-slate-100/50">{totals.open}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.age2}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.age3}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.age7}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.age15}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.parts}</td>
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
                                        <span className="truncate">{branch.officeId} - {branch.branch}</span>
                                      </div>
                                    </td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'total_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'solved_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'cancelled_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center font-bold">{getAggregate(branch, 'open_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'age_2')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'age_3')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'age_7')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'age_15')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'part_pending')}</td>
                                    <td className="p-2 border border-slate-300 text-center">{getAggregate(branch, 'active_eng')}</td>
                                  </tr>

                                  {isExpanded && children.map(child => (
                                    <tr key={child.officeId} className="bg-white/60 hover:bg-white transition-colors text-slate-600 italic">
                                      <td className="p-1.5 pl-8 border border-slate-300">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{child.officeId} - {child.branch}</span>
                                        </div>
                                      </td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.total_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.solved_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] font-bold">{child.open_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.age_2}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.age_3}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.age_7}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.age_15}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">{child.part_pending}</td>
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
                  const matchRegion = filterRegion === 'All' || a.region === filterRegion;
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
                            <th className="p-1.5 border border-slate-600 text-center" colSpan={4}>Calls Summary</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-blue-600" colSpan={7}>Breakdown (Aging)</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-amber-600" colSpan={3}>Deployment</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-emerald-600" colSpan={2}>Installation</th>
                          </tr>
                          <tr className="bg-slate-100 text-slate-700 font-bold">
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1">
                                <span>Region</span>
                                <select
                                  className="w-full bg-white border border-slate-200 rounded px-1 py-0.5 text-[9px] font-medium text-slate-700 outline-none focus:ring-1 focus:ring-slate-400"
                                  value={filterRegion}
                                  onChange={(e) => setFilterRegion(e.target.value)}
                                >
                                  <option value="All">All</option>
                                  {Array.from(new Set(accountsData.map(a => a.region))).sort().map(r => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
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
                                <td className="p-1.5 border border-slate-300 text-center">{a.total_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-600">{a.total_solved}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-rose-600">{a.cancelled_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-black text-slate-900 bg-slate-100/50">{open_calls_sum}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30">{a.age_2 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30">{a.age_3 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30">{a.age_7 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30">{a.age_15 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center font-bold text-blue-700 bg-blue-100/20">{perc_gt_7}</td>

                                <td className="p-1.5 border border-slate-300 text-center">{a.part_pending || 0}</td>
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
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_solved || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-rose-400">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.cancelled_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center bg-slate-800">
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
    </div>
  );
}
