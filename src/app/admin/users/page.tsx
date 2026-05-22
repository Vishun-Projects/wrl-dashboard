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
  Key
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useUser } from '@/components/DashboardLayout';
import { PageShell, PageLoadingState } from '@/components/PageShell';
import BranchTree from '@/components/BranchTree';
import {
  AdminToolbar,
  AdminStatPill,
  AdminTableCard,
  AdminTable,
  AdminThead,
  AdminTh,
  AdminTr,
  AdminTd,
  RoleBadge,
  ChipList,
  AdminIconButton,
} from '@/components/admin/AdminUi';

export default function AdminUsersPage() {
  const { userProfile } = useUser();
  const supabase = createClient();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
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
    role_id: '',
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

      const [usersRes, officesRes, rolesRes] = await Promise.all([
        axios.get('/api/admin/users', { headers: { 'Authorization': `Bearer ${session.access_token}` } }),
        axios.get('/api/offices', { headers: { 'Authorization': `Bearer ${session.access_token}` } }),
        axios.get('/api/admin/roles')
      ]);


      
      // Find current user in the list to check role
      const currentUser = usersRes.data.find((u: any) => u.id === session.user.id);


      setUsers(usersRes.data);
      setOffices(officesRes.data);
      setRoles(rolesRes.data.roles);
    } catch (err) {
      // Silently handle fetch errors for production
      // If forbidden, redirect
      if ((err as any).response?.status === 403) {
        // Silently redirect if unauthorized
        router.push('/report');
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
      setFormData({ name: '', email: '', password: '', role: 'branch_manager', role_id: '', office_ids: [], visible_statuses: [] });
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

  const getRoleInfo = (u: any) => {
    const roleObj = roles.find((r) => r.id === u.role_id);
    const isHod = roleObj ? roleObj.name.toLowerCase() === 'hod' : u.role === 'hod';
    const roleName = roleObj?.name || (u.role === 'hod' ? 'HOD' : 'Branch Manager');
    return { isHod, roleName };
  };

  if (loading) return <PageLoadingState label="Loading users..." />;

  return (
    <PageShell
      title="User Management"
      subtitle="Manage portal accounts, roles, and branch access"
      icon={<Users size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
      toolbar={
        <AdminToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by name or email..."
        >
          <AdminStatPill label="Total" value={users.length} />
          <AdminStatPill label="Showing" value={filteredUsers.length} />
        </AdminToolbar>
      }
      actions={
        <button
          onClick={() => {
            setEditingUser(null);
            setFormData({ name: '', email: '', password: '', role: 'branch_manager', role_id: '', office_ids: [], visible_statuses: [] });
            setBranchSearch('');
            setActiveTab('profile');
            setShowOnlySelectedBranches(false);
            setShowAddModal(true);
          }}
          className="flex h-9 items-center gap-2 rounded-md bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800 ui-label"
        >
          <UserPlus size={14} />
          Add User
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <AdminTableCard isEmpty={filteredUsers.length === 0}>
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh className="w-[28%]">User</AdminTh>
                <AdminTh className="w-[14%]">Role</AdminTh>
                <AdminTh className="w-[22%]">Visible statuses</AdminTh>
                <AdminTh className="w-[22%]">Branches</AdminTh>
                <AdminTh align="right" className="w-[14%]">Actions</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {filteredUsers.map((u) => {
                const { isHod, roleName } = getRoleInfo(u);
                const branchLabels =
                  u.office_ids?.map((id: string) => {
                    const office = offices.find((o) => String(o.ncode) === id);
                    return office?.vcompanyname || id;
                  }) ?? [];

                return (
                  <AdminTr key={u.id}>
                    <AdminTd>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-500">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            u.name?.charAt(0)?.toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-slate-800">{u.name}</p>
                          <p className="truncate text-[11px] text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </AdminTd>
                    <AdminTd>
                      <RoleBadge name={roleName} isHod={isHod} />
                    </AdminTd>
                    <AdminTd>
                      {isHod ? (
                        <span className="text-[11px] font-medium text-emerald-600">All statuses</span>
                      ) : (
                        <ChipList
                          items={u.visible_statuses ?? []}
                          maxVisible={2}
                          emptyLabel="Not configured"
                          variant="indigo"
                        />
                      )}
                    </AdminTd>
                    <AdminTd>
                      {isHod ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <Check size={12} /> Full access
                        </span>
                      ) : (
                        <ChipList
                          items={branchLabels}
                          maxVisible={1}
                          emptyLabel="No branches"
                        />
                      )}
                    </AdminTd>
                    <AdminTd align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <AdminIconButton
                          variant="amber"
                          title="Reset password"
                          onClick={() => {
                            setSelectedUserForPassword(u);
                            setNewPassword('');
                            setShowPasswordModal(true);
                          }}
                        >
                          <Key size={13} />
                        </AdminIconButton>
                        <AdminIconButton
                          title="Edit user"
                          onClick={() => {
                            setEditingUser(u);
                            setFormData({
                              name: u.name,
                              email: u.email,
                              password: '',
                              role: u.role,
                              role_id: u.role_id,
                              office_ids: u.office_ids || [],
                              visible_statuses: u.visible_statuses || [],
                            });
                            setActiveTab('profile');
                            setShowOnlySelectedBranches(false);
                            setShowAddModal(true);
                          }}
                        >
                          <Pencil size={13} />
                        </AdminIconButton>
                        {currentUserInfo?.id !== u.id && (
                          <AdminIconButton
                            variant="danger"
                            title="Delete user"
                            onClick={() => handleDelete(u.id)}
                          >
                            <Trash2 size={13} />
                          </AdminIconButton>
                        )}
                      </div>
                    </AdminTd>
                  </AdminTr>
                );
              })}
            </tbody>
          </AdminTable>
        </AdminTableCard>
      </div>

      {/* Modal - Simplified Sidebar Layout (Shadcn Style) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-xl border border-slate-200 flex min-h-[520px] overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Sidebar Navigation */}
            <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col">
              <div className="p-5 border-b border-slate-200">
                <h2 className="text-base font-medium text-slate-900">
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
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${ activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-slate-100' }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="p-4 border-t border-slate-200 bg-white/50">
                <div className="text-[10px] font-medium text-slate-500 mb-2">Summary</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Branches</span>
                    <span className="font-medium text-slate-700">{formData.office_ids.length}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Statuses</span>
                    <span className="font-medium text-slate-700">{formData.visible_statuses.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-white">
              {/* Content Header */}
              <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between">
                <span className="text-[13px] font-medium text-slate-700">
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
              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                {activeTab === 'profile' ? (
                  <div className="max-w-md space-y-5 animate-in fade-in duration-200">
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
                          {roles.map(role => (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => setFormData({...formData, role: role.name.toLowerCase().replace(' ', '_'), role_id: role.id})}
                              className={`p-2.5 text-left border rounded-lg transition-all ${ formData.role_id === role.id ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300' }`}
                            >
                              <div className={`text-[12px] font-medium ${formData.role_id === role.id ? 'text-indigo-600' : 'text-slate-700'}`}>
                                {role.name}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{role.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Status Section */}
                    <div className="space-y-3">
                      <h4 className="text-[12px] font-medium text-slate-900 flex items-center gap-2">
                        <Shield size={14} className="text-slate-400" />
                        Visible Call Statuses
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map(status => {
                          const isSelected = formData.visible_statuses.includes(status);
                          return (
                            <button
                              key={status} type="button" onClick={() => toggleStatus(status)}
                              className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all ${ isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300' }`}
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
                        <h4 className="text-[12px] font-medium text-slate-900 flex items-center gap-2">
                          <Building2 size={14} className="text-slate-400" />
                          Branch Access
                        </h4>
                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={() => setShowOnlySelectedBranches(!showOnlySelectedBranches)}
                            className="text-[10px] font-medium px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition-colors"
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
                        <div className="max-h-[250px] overflow-y-auto custom-scrollbar p-2">
                          <BranchTree
                            offices={offices}
                            selectedIds={formData.office_ids}
                            setSelectedIds={(ids) => setFormData({ ...formData, office_ids: ids })}
                            single={false}
                            search={branchSearch}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </form>

              {/* Action Footer */}
              <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
                <button 
                  type="button" onClick={() => setShowAddModal(false)}
                  className="px-4 h-9 text-slate-600 rounded-xl font-medium text-[13px] hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    const form = document.querySelector('form');
                    if (form) form.requestSubmit();
                  }}
                  className="px-6 h-9 bg-slate-950 text-white rounded-xl font-medium text-[13px] hover:bg-slate-800 transition-colors"
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
                  <h3 className="text-[15px] font-medium text-slate-900">Reset Password</h3>
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
                  className="px-6 h-10 bg-slate-950 text-white rounded-xl font-medium text-[13px] hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {updatingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}
