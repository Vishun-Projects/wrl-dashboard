'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  LayoutGrid,
  Settings2,
  Globe,
} from 'lucide-react';
import axios from 'axios';
import { feedback } from '@/lib/ui/feedback';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/components/layout/PageShell';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { accessLabelsForPermissions } from '@/lib/auth/rbac-catalog';
import type { RolesUiPageRow } from '@/lib/auth/rbac-catalog';

type PermissionRow = { id: string; name: string; description?: string | null };

type PermissionGroups = {
  pages: RolesUiPageRow[];
  capabilities: PermissionRow[];
  other: PermissionRow[];
};

function PermissionToggle({
  selected,
  onToggle,
  title,
  description,
  subtitle,
  indent,
}: {
  selected: boolean;
  onToggle: () => void;
  title: string;
  description?: string | null;
  subtitle?: string;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
        indent ? 'ml-4' : ''
      } ${
        selected
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-bg-canvas text-slate-600 hover:border-slate-300'
      }`}
    >
      <div
        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${
          selected ? 'bg-bg-canvas/20' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {selected ? <Check size={12} /> : <Lock size={10} />}
      </div>
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold ${selected ? 'text-white' : 'text-slate-800'}`}>
          {title}
        </p>
        {subtitle ? (
          <p
            className={`mt-0.5 text-[9px] uppercase tracking-wide ${selected ? 'text-white/60' : 'text-slate-400'}`}
          >
            {subtitle}
          </p>
        ) : null}
        {description ? (
          <p className={`mt-0.5 text-[10px] ${selected ? 'text-white/70' : 'text-slate-400'}`}>
            {description}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionRow[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroups>({
    pages: [],
    capabilities: [],
    other: [],
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissionIds: [] as string[],
  });

  const reportPages = useMemo(
    () => permissionGroups.pages.filter((p) => p.definition.group === 'Reports'),
    [permissionGroups.pages]
  );

  const adminPages = useMemo(
    () => permissionGroups.pages.filter((p) => p.definition.group === 'Administration'),
    [permissionGroups.pages]
  );

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const rolesRes = await axios.get('/api/admin/roles', { withCredentials: true });
      setRoles(rolesRes.data.roles);
      setAllPermissions(rolesRes.data.allPermissions ?? []);
      const groups = rolesRes.data.permissionGroups ?? {};
      setPermissionGroups({
        pages: groups.pages ?? [],
        capabilities: groups.capabilities ?? [],
        other: groups.other ?? [],
      });
    } catch {
      feedback.actionFailed('Failed to load access control data');
      router.push('/report');
    } finally {
      setLoading(false);
    }
  };

  const permissionIdsFromRole = useCallback(
    (role: { permissions?: string[] }) =>
      allPermissions.filter((p) => role.permissions?.includes(p.name)).map((p) => p.id),
    [allPermissions]
  );

  const handleEdit = (role: any) => {
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description || '',
      permissionIds: permissionIdsFromRole(role),
    });
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/admin/roles?id=${deleteTarget.id}`);
      feedback.actionSuccess('Role deleted successfully');
      setDeleteTarget(null);
      init();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Failed to delete role');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRole) {
        await axios.put('/api/admin/roles', { ...formData, id: editingRole.id });
        feedback.actionSuccess('Role updated');
      } else {
        await axios.post('/api/admin/roles', formData);
        feedback.actionSuccess('Role created');
      }
      setShowModal(false);
      init();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Operation failed');
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

  const isPageFullSelected = (page: RolesUiPageRow) => formData.permissionIds.includes(page.id);

  const isTabSelected = (page: RolesUiPageRow, tabId: string) => {
    if (isPageFullSelected(page)) return true;
    return formData.permissionIds.includes(tabId);
  };

  const togglePageFull = (page: RolesUiPageRow) => {
    const tabIds = page.tabs.map((t) => t.id);
    setFormData((prev) => {
      const hasFull = prev.permissionIds.includes(page.id);
      if (hasFull) {
        return {
          ...prev,
          permissionIds: prev.permissionIds.filter((id) => id !== page.id && !tabIds.includes(id)),
        };
      }
      return {
        ...prev,
        permissionIds: [...new Set([...prev.permissionIds, page.id, ...tabIds])],
      };
    });
  };

  const toggleTab = (page: RolesUiPageRow, tabId: string) => {
    const tabIds = page.tabs.map((t) => t.id);
    setFormData((prev) => {
      const selected = prev.permissionIds.includes(tabId);
      let next = selected
        ? prev.permissionIds.filter((id) => id !== tabId)
        : [...prev.permissionIds, tabId];
      next = next.filter((id) => id !== page.id);
      const allTabsOn = tabIds.every((id) => next.includes(id));
      if (allTabsOn && tabIds.length > 0) {
        next = [...new Set([...next, page.id])];
      }
      return { ...prev, permissionIds: next };
    });
  };

  const filteredRoles = roles.filter(
    (r) =>
      r.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageShell
      title="Roles & Access Control"
      subtitle="Assign pages, tabs, and capabilities per role — sidebar shows only what you grant"
      icon={<ShieldCheck size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <AdminToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search roles...">
          <AdminStatPill label="Roles" value={loading ? '…' : roles.length} />
          <AdminStatPill label="Pages" value={loading ? '…' : permissionGroups.pages.length} />
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
        <AdminTableCard isEmpty={!loading && filteredRoles.length === 0}>
          {loading ? (
            <TableSkeleton columns={4} rows={6} />
          ) : (
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh className="w-[22%]">Role</AdminTh>
                  <AdminTh className="w-[28%]">Description</AdminTh>
                  <AdminTh className="w-[40%]">Access</AdminTh>
                  <AdminTh align="right" className="w-[10%]">
                    Actions
                  </AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {filteredRoles.map((role) => {
                  const pageLabels = accessLabelsForPermissions(role.permissions ?? []);

                  return (
                    <AdminTr key={role.id}>
                      <AdminTd>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-bg-soft text-slate-700">
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
                          items={pageLabels}
                          maxVisible={4}
                          emptyLabel="No access assigned"
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
                            onClick={() => setDeleteTarget({ id: role.id, name: role.name })}
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
          )}
        </AdminTableCard>
      </div>

      {showModal && (
        <ModalPortal open={showModal}>
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <ModalBackdrop onClick={() => setShowModal(false)} />
            <div className="relative z-[1] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-xl animate-in zoom-in-95 duration-200">
              <form onSubmit={handleSubmit}>
                <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-bg-soft">
                      <Key size={16} className="text-slate-700" />
                    </div>
                    <div>
                      <h2 className="text-xs text-slate-900 ui-label">
                        {editingRole ? 'Edit Role' : 'Create Role'}
                      </h2>
                      <p className="text-[10px] text-slate-500">
                        Pages, tabs, and data-scope capabilities
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="rounded-md p-2 text-slate-400 hover:bg-bg-soft hover:text-slate-800"
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
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                      <LayoutGrid size={13} />
                      Report pages
                    </div>
                    <div className="space-y-3">
                      {reportPages.map((page) =>
                        page.tabs.length > 0 ? (
                          <div
                            key={page.pageId}
                            className="rounded-lg border border-slate-200 bg-bg-soft/50 p-3 space-y-2"
                          >
                            <PermissionToggle
                              selected={isPageFullSelected(page)}
                              onToggle={() => togglePageFull(page)}
                              title={`${page.definition.label} — full access`}
                              subtitle={page.definition.path}
                              description="All tabs on this page"
                            />
                            {page.tabs.map((tab) => (
                              <PermissionToggle
                                key={tab.id}
                                indent
                                selected={isTabSelected(page, tab.id)}
                                onToggle={() => toggleTab(page, tab.id)}
                                title={tab.label}
                                description={`Tab permission: ${tab.permission}`}
                              />
                            ))}
                          </div>
                        ) : (
                          <PermissionToggle
                            key={page.pageId}
                            selected={formData.permissionIds.includes(page.id)}
                            onToggle={() => togglePermission(page.id)}
                            title={page.definition.label}
                            subtitle={page.definition.path}
                            description={page.definition.description}
                          />
                        )
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                      <Settings2 size={13} />
                      Administration
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {adminPages.map((p) => (
                        <PermissionToggle
                          key={p.id}
                          selected={formData.permissionIds.includes(p.id)}
                          onToggle={() => togglePermission(p.id)}
                          title={p.definition.label}
                          subtitle={p.definition.path}
                          description={p.definition.description}
                        />
                      ))}
                    </div>
                  </div>

                  {permissionGroups.capabilities.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <Globe size={13} />
                        Capabilities
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {permissionGroups.capabilities.map((p) => (
                          <PermissionToggle
                            key={p.id}
                            selected={formData.permissionIds.includes(p.id)}
                            onToggle={() => togglePermission(p.id)}
                            title={p.name.replace(/_/g, ' ')}
                            description={p.description}
                          />
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Branch assignment is per user in User Management. No branches selected
                        means all branches; View all offices is an explicit national-scope grant.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-bg-soft/80 px-5 py-3">
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
        </ModalPortal>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete role?"
        description={
          deleteTarget ? (
            <>
              Delete <span className="font-medium">{deleteTarget.name}</span>? Users assigned to this
              role may lose access.
            </>
          ) : null
        }
        confirmLabel="Delete role"
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
