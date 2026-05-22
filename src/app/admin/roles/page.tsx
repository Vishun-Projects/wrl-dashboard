'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Shield,
  Key,
  Lock,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { PageShell, PageLoadingState } from '@/components/PageShell';
import {
  AdminToolbar,
  AdminStatPill,
  AdminTableCard,
  AdminTable,
  AdminThead,
  AdminTh,
  AdminTr,
  AdminTd,
  ChipList,
  AdminIconButton,
} from '@/components/admin/AdminUi';

export default function RolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissionIds: [] as string[],
  });

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const rolesRes = await axios.get('/api/admin/roles');
      setRoles(rolesRes.data.roles);
      setAllPermissions(rolesRes.data.allPermissions);
    } catch {
      toast.error('Failed to load access control data');
      router.push('/report');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (role: any) => {
    setEditingRole(role);
    const rolePermissionIds = allPermissions
      .filter((p) => role.permissions.includes(p.name))
      .map((p) => p.id);

    setFormData({
      name: role.name,
      description: role.description || '',
      permissionIds: rolePermissionIds,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this role? This might affect assigned users.')) return;
    try {
      await axios.delete(`/api/admin/roles?id=${id}`);
      toast.success('Role deleted successfully');
      init();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete role');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRole) {
        await axios.put('/api/admin/roles', { ...formData, id: editingRole.id });
        toast.success('Role updated');
      } else {
        await axios.post('/api/admin/roles', formData);
        toast.success('Role created');
      }
      setShowModal(false);
      init();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Operation failed');
    }
  };

  const togglePermission = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      permissionIds: prev.permissionIds.includes(id)
        ? prev.permissionIds.filter((pId) => pId !== id)
        : [...prev.permissionIds, id],
    }));
  };

  const filteredRoles = roles.filter(
    (r) =>
      r.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <PageLoadingState label="Securing access..." />;

  return (
    <PageShell
      title="Roles & Access Control"
      subtitle="Define roles and assign system permissions"
      icon={<ShieldCheck size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
      toolbar={
        <AdminToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search roles...">
          <AdminStatPill label="Roles" value={roles.length} />
          <AdminStatPill label="Permissions" value={allPermissions.length} />
        </AdminToolbar>
      }
      actions={
        <button
          onClick={() => {
            setEditingRole(null);
            setFormData({ name: '', description: '', permissionIds: [] });
            setShowModal(true);
          }}
          className="flex h-9 items-center gap-2 rounded-md bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800 ui-label"
        >
          <Plus size={14} />
          New Role
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <AdminTableCard isEmpty={filteredRoles.length === 0}>
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh className="w-[22%]">Role</AdminTh>
                <AdminTh className="w-[30%]">Description</AdminTh>
                <AdminTh className="w-[38%]">Permissions</AdminTh>
                <AdminTh align="right" className="w-[10%]">Actions</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {filteredRoles.map((role) => {
                const permissionLabels =
                  role.permissions?.map((p: string) => p.replace(/_/g, ' ')) ?? [];

                return (
                  <AdminTr key={role.id}>
                    <AdminTd>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                          <Shield size={14} />
                        </div>
                        <span className="text-[13px] font-medium text-slate-800">{role.name}</span>
                      </div>
                    </AdminTd>
                    <AdminTd>
                      <p className="line-clamp-2 text-[12px] text-slate-500">
                        {role.description || 'No description'}
                      </p>
                    </AdminTd>
                    <AdminTd>
                      <ChipList
                        items={permissionLabels}
                        maxVisible={3}
                        emptyLabel="No permissions"
                        variant="indigo"
                      />
                    </AdminTd>
                    <AdminTd align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <AdminIconButton title="Edit role" onClick={() => handleEdit(role)}>
                          <Pencil size={13} />
                        </AdminIconButton>
                        <AdminIconButton
                          variant="danger"
                          title="Delete role"
                          onClick={() => handleDelete(role.id)}
                        >
                          <Trash2 size={13} />
                        </AdminIconButton>
                      </div>
                    </AdminTd>
                  </AdminTr>
                );
              })}
            </tbody>
          </AdminTable>
        </AdminTableCard>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-in zoom-in-95 duration-200">
            <form onSubmit={handleSubmit}>
              <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                    <Key size={16} className="text-slate-700" />
                  </div>
                  <div>
                    <h2 className="text-xs text-slate-900 ui-label">
                      {editingRole ? 'Edit Role' : 'Create Role'}
                    </h2>
                    <p className="text-[10px] text-slate-500">Access control configuration</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-800"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[60vh] space-y-6 overflow-y-auto p-6 custom-scrollbar">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Role name</label>
                    <input
                      required
                      placeholder="e.g. Regional Manager"
                      className="h-9 w-full rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-500">Description</label>
                    <textarea
                      placeholder="What this role can do..."
                      rows={2}
                      className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-500">Permissions</label>
                    <span className="text-[10px] text-slate-400">{formData.permissionIds.length} selected</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {allPermissions.map((p) => {
                      const isSelected = formData.permissionIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePermission(p.id)}
                          className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                            isSelected
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <div
                            className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${
                              isSelected ? 'bg-white/20' : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {isSelected ? <Check size={12} /> : <Lock size={10} />}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-[11px] font-semibold ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                              {p.name.replace(/_/g, ' ')}
                            </p>
                            {p.description ? (
                              <p className={`mt-0.5 text-[10px] ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                                {p.description}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-md px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 ui-label"
                >
                  {editingRole ? 'Save Role' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}
