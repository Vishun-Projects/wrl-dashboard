'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import axios from 'axios';
import { 
  Users, 
  UserPlus, 
  Building2, 
  Shield, 
  Trash2, 
  Pencil, 
  Check, 
  X,
  Search,
  ArrowLeft,
  ChevronDown,
  LayoutDashboard,
  Key
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function AdminUsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [currentUserInfo, setCurrentUserInfo] = useState<any>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'access'>('profile');
  const [showOnlySelectedBranches, setShowOnlySelectedBranches] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'branch_manager',
    office_ids: [] as string[],
    visible_statuses: [] as string[]
  });

  const router = useRouter();

  useEffect(() => {
    fetchInitialData();
  }, []);

  async function fetchInitialData() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      setCurrentUserInfo(session.user);

      const [usersRes, officesRes] = await Promise.all([
        axios.get('/api/admin/users', { headers: { 'Authorization': `Bearer ${session.access_token}` } }),
        axios.get('/api/offices', { headers: { 'Authorization': `Bearer ${session.access_token}` } })
      ]);


      
      // Find current user in the list to check role
      const currentUser = usersRes.data.find((u: any) => u.id === session.user.id);


      setUsers(usersRes.data);
      setOffices(officesRes.data);
    } catch (err) {
      // Silently handle fetch errors for production
      // If forbidden, redirect
      if ((err as any).response?.status === 403) {
        // Silently redirect if unauthorized
        router.push('/calls');
      }
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (editingUser) {
        await axios.put('/api/admin/users', { ...formData, id: editingUser.id }, {
          headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
      } else {
        await axios.post('/api/admin/users', formData, {
          headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
      }
      setShowAddModal(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'branch_manager', office_ids: [], visible_statuses: [] });
      setBranchSearch('');
      fetchInitialData();
      toast.success(editingUser ? 'User updated successfully' : 'User created successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.delete(`/api/admin/users?id=${userId}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      toast.success('User deleted successfully');
      fetchInitialData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPassword || !newPassword.trim()) return;
    
    setUpdatingPassword(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post('/api/admin/users/password', { 
        userId: selectedUserForPassword.id, 
        newPassword 
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      toast.success('Password updated successfully');
      setShowPasswordModal(false);
      setNewPassword('');
      setSelectedUserForPassword(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Password update failed');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const toggleOffice = (officeId: string) => {
    setFormData(prev => ({
      ...prev,
      office_ids: prev.office_ids.includes(officeId)
        ? prev.office_ids.filter(id => id !== officeId)
        : [...prev.office_ids, officeId]
    }));
  };

  const toggleStatus = (status: string) => {
    setFormData(prev => ({
      ...prev,
      visible_statuses: prev.visible_statuses.includes(status)
        ? prev.visible_statuses.filter(s => s !== status)
        : [...prev.visible_statuses, status]
    }));
  };

  const STATUS_OPTIONS = [
    'Open Unallocated',
    'Assigned',
    'Tech. Solve Call',
    'Closed'
  ];

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(search.toLowerCase()) || 
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Loading...</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] overflow-hidden text-slate-700 font-sans">
      {/* Header - Matching Calls Page */}
      <header className="flex-shrink-0 bg-white border-b border-[#e2e8f0]">
        <div className="h-14 px-7 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <img src="/western-head-logo-2025.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain shadow-sm" />
              <h1 className="text-[14px] font-bold text-[#0f172a] leading-none">Admin</h1>
            </div>
            
            <nav className="h-14 flex items-center border-l border-slate-100 pl-6 ml-2 gap-1">
              <button 
                onClick={() => router.push('/calls')}
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-500 hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                <LayoutDashboard size={16} />
                Calls
              </button>
              <div className="h-9 px-4 rounded-lg text-[13px] font-bold text-[#0f172a] bg-slate-50 border border-slate-200 flex items-center gap-2">
                <Users size={16} />
                Users
              </div>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end mr-2">
              <span className="text-[12px] font-bold text-[#0f172a]">{currentUserInfo?.user_metadata?.name || 'Administrator'}</span>
              <span className="text-[10px] text-slate-400 font-medium">{currentUserInfo?.email}</span>
            </div>
            
            <button 
              onClick={() => {
                setEditingUser(null);
                setFormData({ name: '', email: '', password: '', role: 'branch_manager', office_ids: [], visible_statuses: [] });
                setBranchSearch('');
                setActiveTab('profile');
                setShowOnlySelectedBranches(false);
                setShowAddModal(true);
              }}
              className="h-9 px-4 bg-[#0f172a] text-white rounded-lg font-bold text-[12px] flex items-center gap-2 hover:bg-slate-800 transition-all shadow-sm active:scale-95 uppercase tracking-wider"
            >
              <UserPlus size={14} />
              Add User
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-7 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Controls Bar */}
          <div className="flex items-center justify-between gap-4">
             <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                placeholder="Search users..."
                className="w-full h-10 bg-white border border-[#e2e8f0] rounded-xl pl-10 pr-4 text-[13px] outline-none focus:border-slate-400 transition-all shadow-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-4 bg-white px-4 py-2 border border-[#e2e8f0] rounded-xl shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-400">Total Users:</span>
                <span className="text-[13px] font-bold text-slate-700">{users.length}</span>
              </div>
            </div>
          </div>

          {/* Table Container - Same style as CallTable */}
          <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">User</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Role</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Statuses</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Branches</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-[13px] font-bold text-slate-500 border border-slate-200">
                          {u.name?.charAt(0)}
                        </div>
                        <div>
                          <div className="text-[13px] font-bold text-slate-700">{u.name}</div>
                          <div className="text-[11px] text-slate-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                        u.role === 'hod' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-50 text-slate-500 border border-slate-200'
                      }`}>
                        <Shield size={12} />
                        {u.role === 'hod' ? 'HOD' : 'Manager'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      {u.role === 'hod' ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 italic">
                          All Statuses Visible
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.visible_statuses?.length > 0 ? (
                            u.visible_statuses.map((s: string) => (
                              <span key={s} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 rounded text-[9px] font-bold text-indigo-600">
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-300 italic">No restriction (HOD only)</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5">
                      {u.role === 'hod' ? (
                        <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-600">
                          <Check size={14} /> Full Access
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-[240px]">
                          {u.office_ids?.length > 0 ? (
                            u.office_ids.map((id: string) => {
                              const office = offices.find(o => String(o.ncode) === id);
                              return (
                                <span key={id} className="px-2 py-0.5 bg-slate-50 border border-slate-100 rounded text-[10px] font-medium text-slate-500">
                                  {office?.vcompanyname || id}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-[11px] text-slate-300 italic">No access granted</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => {
                              setSelectedUserForPassword(u);
                              setNewPassword('');
                              setShowPasswordModal(true);
                            }}
                            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-all text-slate-400 opacity-0 group-hover:opacity-100 shadow-sm"
                            title="Reset Password"
                          >
                            <Key size={13} />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingUser(u);
                            setFormData({ 
                              name: u.name, 
                              email: u.email, 
                              password: '', 
                              role: u.role, 
                              office_ids: u.office_ids || [],
                              visible_statuses: u.visible_statuses || []
                            });
                            setActiveTab('profile');
                            setShowOnlySelectedBranches(false);
                            setShowAddModal(true);
                          }}
                          className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all text-slate-400 opacity-0 group-hover:opacity-100 shadow-sm"
                          title="Edit User"
                        >
                          <Pencil size={13} />
                        </button>
                        {currentUserInfo?.id !== u.id && (
                          <button 
                            onClick={() => handleDelete(u.id)}
                            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-all text-slate-400 opacity-0 group-hover:opacity-100 shadow-sm"
                            title="Delete User"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal - Simplified Sidebar Layout (Shadcn Style) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl rounded-xl border border-slate-200 shadow-2xl flex h-[600px] overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Sidebar Navigation */}
            <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-[15px] font-bold text-slate-900">
                  {editingUser ? 'Edit User' : 'New User'}
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">Configure account & access</p>
              </div>
              
              <nav className="flex-1 p-3 space-y-1">
                {[
                  { id: 'profile', label: 'Profile Details', icon: Users },
                  { id: 'access', label: 'Access Control', icon: Shield }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                      activeTab === tab.id 
                        ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' 
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="p-4 border-t border-slate-200 bg-white/50">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Summary</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Branches</span>
                    <span className="font-bold text-slate-700">{formData.office_ids.length}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Statuses</span>
                    <span className="font-bold text-slate-700">{formData.visible_statuses.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-white">
              {/* Content Header */}
              <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between">
                <span className="text-[13px] font-bold text-slate-700 uppercase tracking-wider">
                  {activeTab === 'profile' ? 'User Profile' : 'Permissions & Visibility'}
                </span>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === 'profile' ? (
                  <div className="max-w-md space-y-6 animate-in fade-in duration-200">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-700">Full Name</label>
                        <input 
                          required
                          className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-700">Email Address</label>
                        <input 
                          required type="email" disabled={!!editingUser}
                          className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:bg-slate-50 disabled:text-slate-500"
                          value={formData.email}
                          onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                      </div>

                      {!editingUser && (
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-slate-700">Password</label>
                          <input 
                            required type="password"
                            className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                          />
                        </div>
                      )}

                      <div className="space-y-1.5 pt-2">
                        <label className="text-[12px] font-medium text-slate-700">System Role</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'branch_manager', label: 'Branch Manager', desc: 'Limited branch access' },
                            { id: 'hod', label: 'HOD', desc: 'Full system access' }
                          ].map(role => (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => setFormData({...formData, role: role.id})}
                              className={`p-3 text-left border rounded-lg transition-all ${
                                formData.role === role.id 
                                  ? 'border-indigo-600 bg-indigo-50/50' 
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className={`text-[12px] font-bold ${formData.role === role.id ? 'text-indigo-600' : 'text-slate-700'}`}>
                                {role.label}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{role.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8 animate-in fade-in duration-200">
                    {/* Status Section */}
                    <div className="space-y-3">
                      <h4 className="text-[12px] font-bold text-slate-900 flex items-center gap-2">
                        <Shield size={14} className="text-slate-400" />
                        Visible Call Statuses
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map(status => {
                          const isSelected = formData.visible_statuses.includes(status);
                          return (
                            <button
                              key={status} type="button" onClick={() => toggleStatus(status)}
                              className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all ${
                                isSelected 
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' 
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                              }`}
                            >
                              {status}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Branches Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[12px] font-bold text-slate-900 flex items-center gap-2">
                          <Building2 size={14} className="text-slate-400" />
                          Branch Access
                        </h4>
                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={() => setShowOnlySelectedBranches(!showOnlySelectedBranches)}
                            className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition-colors"
                          >
                            {showOnlySelectedBranches ? 'Show All' : `Show Selected (${formData.office_ids.length})`}
                          </button>
                        </div>
                      </div>

                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="p-2 bg-slate-50 border-b border-slate-200">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input 
                              placeholder="Filter branches..."
                              className="w-full h-8 bg-white border border-slate-200 rounded pl-8 pr-3 text-[12px] focus:outline-none focus:border-indigo-500"
                              value={branchSearch}
                              onChange={(e) => setBranchSearch(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="max-h-[250px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                          {offices
                            .filter(o => {
                              const matchesSearch = o.vcompanyname?.toLowerCase().includes(branchSearch.toLowerCase()) || String(o.ncode).includes(branchSearch);
                              const isSelected = formData.office_ids.includes(String(o.ncode));
                              return showOnlySelectedBranches ? (isSelected && matchesSearch) : matchesSearch;
                            })
                            .map(o => {
                              const isSelected = formData.office_ids.includes(String(o.ncode));
                              return (
                                <button
                                  key={o.ncode} type="button" onClick={() => toggleOffice(String(o.ncode))}
                                  className={`w-full flex items-center justify-between p-3 transition-colors text-left group ${
                                    isSelected ? 'bg-indigo-50/50' : 'bg-white hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                                      isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'
                                    }`}>
                                      {isSelected && <Check size={10} />}
                                    </div>
                                    <div className="min-w-0">
                                      <div className={`text-[12px] font-medium truncate ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>
                                        {o.vcompanyname}
                                      </div>
                                      <div className="text-[10px] text-slate-400">#{o.ncode}</div>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </form>

              {/* Action Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
                <button 
                  type="button" onClick={() => setShowAddModal(false)}
                  className="px-4 h-9 text-slate-600 rounded-md font-medium text-[13px] hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    const form = document.querySelector('form');
                    if (form) form.requestSubmit();
                  }}
                  className="px-6 h-9 bg-indigo-600 text-white rounded-md font-bold text-[13px] hover:bg-indigo-700 transition-all shadow-sm active:scale-95"
                >
                  {editingUser ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-xl border border-slate-200 shadow-2xl p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                  <Key size={20} />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-900">Reset Password</h3>
                  <p className="text-[11px] text-slate-500">Updating for {selectedUserForPassword?.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPasswordModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-slate-700">New Password</label>
                <input 
                  required type="password"
                  autoFocus
                  placeholder="Enter new secure password"
                  className="w-full h-10 bg-white border border-slate-200 rounded-lg px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button 
                  type="button" onClick={() => setShowPasswordModal(false)}
                  className="px-4 h-10 text-slate-600 rounded-lg font-medium text-[13px] hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={updatingPassword || !newPassword.trim()}
                  className="px-6 h-10 bg-amber-500 text-white rounded-lg font-bold text-[13px] hover:bg-amber-600 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                >
                  {updatingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
