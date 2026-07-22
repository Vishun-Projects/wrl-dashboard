'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { resolveAvatarDisplayUrl } from '@/lib/auth/avatar-url';
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
  Key,
  Mail
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { feedback } from '@/lib/ui/feedback';
import { useUser } from '@/components/layout/DashboardLayout';
import { seesAllOfficesForUser } from '@/lib/auth/rbac-catalog';
import { PageShell } from '@/components/layout/PageShell';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import BranchTree from '@/components/shared/BranchTree';
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';

function roleHasMisPermissions(permissions: string[] | undefined): boolean {
  const perms = permissions ?? [];
  return (
    perms.includes('tab_mis_summary') ||
    perms.includes('tab_mis_register') ||
    perms.includes('tab_mis_accounts')
  );
}

type UserSortKey = 'user' | 'role' | 'statuses' | 'branches' | 'misEmail';

export default function AdminUsersPage() {
  const { userProfile } = useUser();
  const apiOpts = { withCredentials: true as const };
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState<UserSortKey> | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'access'>('profile');
  const [showOnlySelectedBranches, setShowOnlySelectedBranches] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [officesLoading, setOfficesLoading] = useState(false);
  const bootstrapInflightRef = useRef<Promise<void> | null>(null);

  type UserFormErrors = {
    name?: string;
    email?: string;
    password?: string;
    role_id?: string;
  };

  function validateUserForm(
    data: ReturnType<typeof emptyFormData>,
    isEdit: boolean
  ): UserFormErrors {
    const errors: UserFormErrors = {};
    if (!data.name.trim()) {
      errors.name = 'Full name is required';
    }
    if (!isEdit) {
      const email = data.email.trim();
      if (!email) {
        errors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Enter a valid email address';
      }
      if (!data.password) {
        errors.password = 'Password is required';
      } else if (data.password.length < 6) {
        errors.password = 'Password must be at least 6 characters';
      }
    }
    if (!data.role_id?.trim()) {
      errors.role_id = 'Select a system role';
    }
    return errors;
  }

  const emptyFormData = (rolesList: typeof roles = roles) => {
    const first = rolesList[0];
    const roleSlug = first?.name
      ? String(first.name).toLowerCase().replace(/\s+/g, '_')
      : 'branch_manager';
    return {
      name: '',
      email: '',
      password: '',
      role: roleSlug,
      role_id: first?.id ?? '',
      office_ids: [] as string[],
      visible_statuses: [] as string[],
      mis_email_enabled: false,
    };
  };

  // Form State
  const [formData, setFormData] = useState(emptyFormData([]));
  const [showValidation, setShowValidation] = useState(false);

  const formErrors = validateUserForm(formData, !!editingUser);
  const isFormValid = Object.keys(formErrors).length === 0;

  const router = useRouter();

  const inputClass = (hasError: boolean) =>
    `w-full h-9 bg-bg-canvas border rounded-md px-3 text-[13px] transition-all focus:outline-none focus:ring-2 ${
      hasError
        ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20'
        : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500'
    }`;

  useEffect(() => {
    if (!userProfile?.id) return;
    void fetchInitialData();
  }, [userProfile?.id]);

  async function ensureOfficesLoaded() {
    if (offices.length > 0 || officesLoading) return;
    setOfficesLoading(true);
    try {
      const res = await axios.get('/api/offices', apiOpts);
      setOffices(res.data);
    } catch {
      feedback.actionFailed('Failed to load branch list');
    } finally {
      setOfficesLoading(false);
    }
  }

  async function fetchInitialData() {
    if (bootstrapInflightRef.current) {
      await bootstrapInflightRef.current;
      return;
    }
    const run = (async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/bootstrap', apiOpts);
      setUsers(res.data.users);
      setRoles(res.data.roles);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        router.push('/login');
        return;
      }
      if (status === 403) {
        router.push('/report');
      }
    } finally {
      setLoading(false);
    }
    })();
    bootstrapInflightRef.current = run;
    try {
      await run;
    } finally {
      bootstrapInflightRef.current = null;
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidation(true);
    const errors = validateUserForm(formData, !!editingUser);
    if (Object.keys(errors).length > 0) {
      const needsProfile =
        errors.name || errors.email || errors.password || errors.role_id;
      if (needsProfile) setActiveTab('profile');
      return;
    }
    try {
      if (editingUser) {
        await axios.put('/api/admin/users', { ...formData, id: editingUser.id }, apiOpts);
      } else {
        const res = await axios.post('/api/admin/users', formData, apiOpts);
        if (res.data?.recovered) {
          feedback.actionSuccess('User profile completed (login already existed)');
        } else {
          feedback.actionSuccess('User created successfully');
        }
        setShowAddModal(false);
        setEditingUser(null);
        setFormData(emptyFormData());
        setShowValidation(false);
        setBranchSearch('');
        fetchInitialData();
        return;
      }
      setShowAddModal(false);
      setEditingUser(null);
      setFormData(emptyFormData());
      setShowValidation(false);
      setBranchSearch('');
      fetchInitialData();
      feedback.actionSuccess('User updated successfully');
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/admin/users?id=${deleteTarget.id}`, apiOpts);
      feedback.actionSuccess('User deleted successfully');
      setDeleteTarget(null);
      fetchInitialData();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPassword || !newPassword.trim()) return;
    
    setUpdatingPassword(true);
    try {
      await axios.post(
        '/api/admin/users/password',
        { userId: selectedUserForPassword.id, newPassword },
        apiOpts
      );
      feedback.actionSuccess('Password updated successfully');
      setShowPasswordModal(false);
      setNewPassword('');
      setSelectedUserForPassword(null);
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Password update failed');
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
    const rolePerms = roleObj?.permissions ?? [];
    const isNational = seesAllOfficesForUser(rolePerms, u.role ?? '', u.office_ids ?? []);
    const roleName = roleObj?.name || (u.role === 'hod' ? 'HOD' : 'Branch Manager');
    const canMisEmail = roleHasMisPermissions(rolePerms);
    return { isHod: isNational, roleName, canMisEmail };
  };

  const selectedRole = roles.find((r) => r.id === formData.role_id);
  const formRoleCanMisEmail = roleHasMisPermissions(selectedRole?.permissions);

  const branchLabelsForUser = (u: any) => {
    const ids = u.office_ids ?? [];
    if (seesAllOfficesForUser([], u.role ?? '', ids)) {
      return ['All branches'];
    }
    if (offices.length === 0) {
      return ids.length > 0 ? [`${ids.length} branch${ids.length === 1 ? '' : 'es'}`] : ['All branches'];
    }
    return ids.map((id: string) => {
      const office = offices.find((o) => String(o.ncode) === id);
      return office?.vcompanyname || id;
    });
  };

  const sortedUsers = useMemo(() => {
    if (!sort) return filteredUsers;
    return sortRows(filteredUsers, (u) => {
      const { roleName, isHod } = getRoleInfo(u);
      const branchLabels = branchLabelsForUser(u);
      switch (sort.key) {
        case 'user':
          return u.name ?? u.email ?? '';
        case 'role':
          return roleName;
        case 'statuses':
          return isHod ? 'All statuses' : (u.visible_statuses ?? []).join(', ');
        case 'branches':
          return branchLabels.join(', ');
        case 'misEmail':
          return Boolean(u.mis_email_enabled);
        default:
          return '';
      }
    }, sort.dir);
  }, [filteredUsers, sort, roles, offices]);

  const handleSort = (key: UserSortKey) => {
    setSort((p) => toggleSort(p, key, key === 'user' || key === 'role' ? 'asc' : 'desc'));
  };

  const openUserModal = (user?: any) => {
    void ensureOfficesLoaded();
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: '',
        role: user.role,
        role_id: user.role_id,
        office_ids: user.office_ids || [],
        visible_statuses: user.visible_statuses || [],
        mis_email_enabled: Boolean(user.mis_email_enabled),
      });
      setActiveTab('profile');
      setShowOnlySelectedBranches(false);
      setShowValidation(false);
    } else {
      setEditingUser(null);
      setFormData(emptyFormData());
      setShowValidation(false);
      setBranchSearch('');
      setActiveTab('profile');
      setShowOnlySelectedBranches(false);
    }
    setShowAddModal(true);
  };

  return (
    <PageShell
      title="User Management"
      subtitle="Manage portal accounts, roles, and branch access"
      icon={<Users size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <AdminToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by name or email..."
        >
          <AdminStatPill label="Total" value={loading ? '…' : users.length} />
          <AdminStatPill label="Showing" value={loading ? '…' : filteredUsers.length} />
        </AdminToolbar>
      }
      actions={
        <button
          onClick={() => openUserModal()}
          className="flex h-9 items-center gap-2 rounded-md bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800 ui-label"
        >
          <UserPlus size={14} />
          Add User
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <AdminTableCard isEmpty={!loading && filteredUsers.length === 0}>
          {loading ? (
            <TableSkeleton columns={6} rows={8} />
          ) : (
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh
                  className="w-[28%]"
                  sortable
                  sortKey="user"
                  sort={sort}
                  onSort={(k) => handleSort(k as UserSortKey)}
                >
                  User
                </AdminTh>
                <AdminTh
                  className="w-[14%]"
                  sortable
                  sortKey="role"
                  sort={sort}
                  onSort={(k) => handleSort(k as UserSortKey)}
                >
                  Role
                </AdminTh>
                <AdminTh
                  className="w-[22%]"
                  sortable
                  sortKey="statuses"
                  sort={sort}
                  onSort={(k) => handleSort(k as UserSortKey)}
                >
                  Visible statuses
                </AdminTh>
                <AdminTh
                  className="w-[22%]"
                  sortable
                  sortKey="branches"
                  sort={sort}
                  onSort={(k) => handleSort(k as UserSortKey)}
                >
                  Branches
                </AdminTh>
                <AdminTh
                  className="w-[10%]"
                  sortable
                  sortKey="misEmail"
                  sort={sort}
                  onSort={(k) => handleSort(k as UserSortKey)}
                >
                  MIS email
                </AdminTh>
                <AdminTh align="right" className="w-[14%]">Actions</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {sortedUsers.map((u) => {
                const { isHod, roleName, canMisEmail } = getRoleInfo(u);
                const branchLabels = branchLabelsForUser(u);

                return (
                  <AdminTr key={u.id}>
                    <AdminTd>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-500">
                          {u.avatar_url ? (
                            <img
                              src={resolveAvatarDisplayUrl(u.avatar_url) ?? ''}
                              alt=""
                              className="h-full w-full object-cover"
                            />
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
                    <AdminTd>
                      {u.mis_email_enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          <Mail size={11} /> On
                        </span>
                      ) : canMisEmail ? (
                        <span className="text-[11px] text-slate-400">Off</span>
                      ) : (
                        <span className="text-[11px] text-slate-300" title="Assign MIS report permissions first">
                          —
                        </span>
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
                          onClick={() => openUserModal(u)}
                        >
                          <Pencil size={13} />
                        </AdminIconButton>
                        {userProfile?.id !== u.id && (
                          <AdminIconButton
                            variant="danger"
                            title="Delete user"
                            onClick={() => setDeleteTarget({ id: u.id, name: u.name || u.email })}
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
          )}
        </AdminTableCard>
      </div>

      {/* Modal - Simplified Sidebar Layout (Shadcn Style) */}
      {showAddModal && (
        <ModalPortal open={showAddModal}>
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <ModalBackdrop onClick={() => setShowAddModal(false)} />
          <div className="relative z-[1] flex min-h-[520px] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas animate-in zoom-in-95 duration-200">
            
            {/* Sidebar Navigation */}
            <div className="w-56 bg-bg-soft border-r border-slate-200 flex flex-col">
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
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${ activeTab === tab.id ? 'bg-bg-canvas text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-slate-100' }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="p-4 border-t border-slate-200 bg-bg-canvas/50 space-y-3">
                {!editingUser && (
                  <div>
                    <div className="text-[10px] font-medium text-slate-500 mb-2">Required to create</div>
                    <ul className="space-y-1.5">
                      {[
                        { key: 'name', label: 'Full name', ok: !formErrors.name },
                        { key: 'email', label: 'Email', ok: !formErrors.email },
                        { key: 'password', label: 'Password (6+ chars)', ok: !formErrors.password },
                        { key: 'role', label: 'System role', ok: !formErrors.role_id },
                      ].map((item) => (
                        <li
                          key={item.key}
                          className={`flex items-center gap-2 text-[11px] ${item.ok ? 'text-emerald-600' : 'text-slate-500'}`}
                        >
                          {item.ok ? (
                            <Check size={12} className="flex-shrink-0" />
                          ) : (
                            <span className="w-3 h-3 rounded-full border border-slate-300 flex-shrink-0" />
                          )}
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
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
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-bg-canvas">
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
              <form
                id="admin-user-form"
                onSubmit={handleSubmit}
                noValidate
                className="flex-1 overflow-y-auto p-6 custom-scrollbar"
              >
                {activeTab === 'profile' ? (
                  <div className="max-w-md space-y-5 animate-in fade-in duration-200">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-700">
                          Full Name <span className="text-rose-500">*</span>
                        </label>
                        <input
                          required
                          aria-invalid={showValidation && !!formErrors.name}
                          className={inputClass(showValidation && !!formErrors.name)}
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                        {showValidation && formErrors.name && (
                          <p className="text-[11px] text-rose-600">{formErrors.name}</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-700">
                          Email Address {!editingUser && <span className="text-rose-500">*</span>}
                        </label>
                        <input
                          required
                          type="email"
                          disabled={!!editingUser}
                          aria-invalid={showValidation && !!formErrors.email}
                          className={`${inputClass(showValidation && !!formErrors.email)} disabled:bg-bg-soft disabled:text-slate-500`}
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                        {showValidation && formErrors.email && (
                          <p className="text-[11px] text-rose-600">{formErrors.email}</p>
                        )}
                      </div>

                      {!editingUser && (
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-slate-700">
                            Password <span className="text-rose-500">*</span>
                          </label>
                          <input
                            required
                            type="password"
                            minLength={6}
                            aria-invalid={showValidation && !!formErrors.password}
                            className={inputClass(showValidation && !!formErrors.password)}
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          />
                          {showValidation && formErrors.password ? (
                            <p className="text-[11px] text-rose-600">{formErrors.password}</p>
                          ) : (
                            <p className="text-[11px] text-slate-400">Minimum 6 characters</p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5 pt-2">
                        <label className="text-[12px] font-medium text-slate-700">
                          System Role <span className="text-rose-500">*</span>
                        </label>
                        <div
                          className={`grid grid-cols-2 gap-2 rounded-lg p-0.5 ${
                            showValidation && formErrors.role_id ? 'ring-1 ring-rose-300' : ''
                          }`}
                        >
                          {roles.map(role => (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => {
                                const canEmail = roleHasMisPermissions(role.permissions);
                                setFormData({
                                  ...formData,
                                  role: role.name.toLowerCase().replace(' ', '_'),
                                  role_id: role.id,
                                  mis_email_enabled: canEmail ? formData.mis_email_enabled : false,
                                });
                              }}
                              className={`p-2.5 text-left border rounded-lg transition-all ${ formData.role_id === role.id ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300' }`}
                            >
                              <div className={`text-[12px] font-medium ${formData.role_id === role.id ? 'text-indigo-600' : 'text-slate-700'}`}>
                                {role.name}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{role.description}</div>
                            </button>
                          ))}
                        </div>
                        {showValidation && formErrors.role_id && (
                          <p className="text-[11px] text-rose-600">{formErrors.role_id}</p>
                        )}
                      </div>

                      {editingUser ? (
                        <div className="space-y-2 rounded-lg border border-slate-200 bg-bg-soft/50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-medium text-slate-800 flex items-center gap-1.5">
                                <Mail size={14} className="text-slate-400" />
                                MIS email reports
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                                Allow this user to receive scheduled MIS digests. They can fine-tune
                                schedule and report types in Profile.
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!formRoleCanMisEmail}
                              title={
                                formRoleCanMisEmail
                                  ? undefined
                                  : 'Assign a role with MIS report access first'
                              }
                              onClick={() => {
                                if (!formRoleCanMisEmail) return;
                                setFormData((prev) => ({
                                  ...prev,
                                  mis_email_enabled: !prev.mis_email_enabled,
                                }));
                              }}
                              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                                !formRoleCanMisEmail
                                  ? 'cursor-not-allowed bg-slate-200'
                                  : formData.mis_email_enabled
                                    ? 'bg-emerald-500'
                                    : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                  formData.mis_email_enabled && formRoleCanMisEmail
                                    ? 'translate-x-5'
                                    : ''
                                }`}
                              />
                            </button>
                          </div>
                          {!formRoleCanMisEmail ? (
                            <p className="text-[10px] text-amber-700">
                              Select a role with Summary, Register, or Key Account access to enable email.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
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
                              className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all ${ isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-bg-canvas border-slate-200 text-slate-600 hover:border-slate-300' }`}
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

                      <p className="text-[10px] text-slate-500">
                        Optional data scope per user. No branches selected means access to all
                        branches. Select specific branches to limit which offices this user can see.
                      </p>
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="p-2 bg-bg-soft border-b border-slate-200">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input 
                              placeholder="Filter branches..."
                              className="w-full h-8 bg-bg-canvas border border-slate-200 rounded pl-8 pr-3 text-[12px] focus:outline-none focus:border-indigo-500"
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
              <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end gap-3 bg-bg-soft/50">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setShowValidation(false);
                  }}
                  className="px-4 h-9 text-slate-600 rounded-xl font-medium text-[13px] hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="admin-user-form"
                  disabled={!isFormValid}
                  title={
                    !isFormValid
                      ? 'Fill in all required fields (see checklist on the left)'
                      : undefined
                  }
                  className="px-6 h-9 bg-slate-950 text-white rounded-xl font-medium text-[13px] hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {editingUser ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Password Reset Modal */}
      {showPasswordModal && (
        <ModalPortal open={showPasswordModal}>
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <ModalBackdrop onClick={() => setShowPasswordModal(false)} />
          <div className="relative z-[1] w-full max-w-md rounded-xl border border-slate-200 bg-bg-canvas p-6 shadow-2xl animate-in zoom-in-95 duration-200">
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
                  className="w-full h-10 bg-bg-canvas border border-slate-200 rounded-lg px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
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
        </ModalPortal>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete user?"
        description={
          deleteTarget ? (
            <>
              Are you sure you want to delete <span className="font-medium">{deleteTarget.name}</span>?
              This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete user"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
