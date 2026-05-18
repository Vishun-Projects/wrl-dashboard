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
  ChevronRight,
  Info
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useUser } from '@/components/DashboardLayout';
import { useRouter } from 'next/navigation';

export default function RolesPage() {
  const router = useRouter();
  const { userProfile } = useUser();
  const [roles, setRoles] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissionIds: [] as string[]
  });

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const rolesRes = await axios.get('/api/admin/roles');
      setRoles(rolesRes.data.roles);
      setAllPermissions(rolesRes.data.allPermissions);
    } catch (err) {
      toast.error('Failed to load access control data');
      router.push('/calls');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (role: any) => {
    setEditingRole(role);
    // Find permission IDs by matching names
    const rolePermissionIds = allPermissions
      .filter(p => role.permissions.includes(p.name))
      .map(p => p.id);
      
    setFormData({
      name: role.name,
      description: role.description || '',
      permissionIds: rolePermissionIds
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
    setFormData(prev => ({
      ...prev,
      permissionIds: prev.permissionIds.includes(id)
        ? prev.permissionIds.filter(pId => pId !== id)
        : [...prev.permissionIds, id]
    }));
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500">Securing access...</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#f8fafc]">
      
      <header className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="h-14 px-7 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ShieldCheck className="text-slate-900" size={18} />
            <h1 className="text-base font-medium text-slate-900">Roles & Access Control</h1>
          </div>

          <button 
            onClick={() => {
              setEditingRole(null);
              setFormData({ name: '', description: '', permissionIds: [] });
              setShowModal(true);
            }}
            className="h-9 px-4 bg-slate-950 text-white rounded-xl font-medium text-[12px] flex items-center gap-2 hover:bg-slate-800 transition-colors"
          >
            <Plus size={14} />
            New Role
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-7 custom-scrollbar">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {roles.map((role) => (
              <div key={role.id} className="bg-white border border-slate-200 rounded-xl p-5 group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-900 group-hover:bg-slate-900 group-hover:text-white transition-all">
                      <Shield size={20} />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900 text-[15px]">{role.name}</h3>
                      <p className="text-[12px] text-slate-400">{role.description || 'No description provided'}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(role)} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-900 transition-all">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => handleDelete(role.id)} className="p-2 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition-all">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 mt-6">
                  <p className="text-[10px] font-medium text-slate-500 mb-3 flex items-center gap-2">
                    <Lock size={10} />
                    Active Permissions ({role.permissions?.length || 0})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {role.permissions && role.permissions.map((p: string) => (
                      <span key={p} className="px-2.5 py-1 bg-slate-50 border border-slate-100 text-slate-600 rounded-lg text-[10px] font-medium">
                        {p.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {(!role.permissions || role.permissions.length === 0) && (
                      <span className="text-[11px] text-slate-300 italic">No permissions assigned</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowModal(false)} />
          <div className="bg-white rounded-3xl w-full max-w-2xl z-10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <form onSubmit={handleSubmit}>
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex items-center justify-center">
                    <Key className="text-slate-900" size={24} />
                  </div>
                  <div>
                    <h2 className="text-base font-medium text-slate-900">
                      {editingRole ? 'Edit Role' : 'Create New Role'}
                    </h2>
                    <p className="text-[12px] text-slate-500">Access Control Configuration</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowModal(false)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white transition-all text-slate-400 hover:text-slate-900">
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 ml-1">Role Identifier</label>
                    <input
                      required
                      placeholder="e.g. Regional Manager"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-[14px] font-medium text-slate-900 outline-none focus:ring-2 focus:ring-slate-100 focus:border-slate-300 transition-colors"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500 ml-1">Purpose / Description</label>
                    <textarea
                      placeholder="Briefly describe what this role can do..."
                      rows={2}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-[14px] font-medium text-slate-600 outline-none focus:ring-2 focus:ring-slate-100 focus:border-slate-300 transition-colors resize-none"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500 ml-1">System Permissions</label>
                    <span className="text-[10px] font-medium text-slate-300 italic">{formData.permissionIds.length} selected</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {allPermissions.map((p) => {
                      const isSelected = formData.permissionIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePermission(p.id)}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-left group ${ isSelected ? 'bg-slate-950 border-slate-950 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400' }`}
                        >
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${ isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400' }`}>
                            {isSelected ? <Check size={14} /> : <Lock size={12} />}
                          </div>
                          <div>
                            <p className={`text-[12px] font-medium ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                              {p.name.replace(/_/g, ' ')}
                            </p>
                            <p className={`text-[10px] leading-tight mt-0.5 ${isSelected ? 'text-white/60' : 'text-slate-400 font-medium'}`}>
                              {p.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-5 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-3 text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-slate-950 text-white px-6 py-3 rounded-xl text-[13px] font-medium hover:bg-slate-800 transition-colors"
                >
                  {editingRole ? 'Update Access' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
  );
}
