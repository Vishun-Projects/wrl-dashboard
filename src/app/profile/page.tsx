'use client';

import React, { useState, useEffect } from 'react';
import { 
  User, 
  Mail, 
  Shield, 
  Camera, 
  Lock, 
  Save, 
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useUser } from '@/components/DashboardLayout';
import axios from 'axios';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ProfilePage() {
  const { userProfile: user, loadingProfile: loading, refreshProfile: fetchProfile } = useUser();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  
  // Form States
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') setActiveTab('settings');
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
    }
  }, [user]);

  async function handleUpdateProfile() {
    try {
      setSaving(true);
      await axios.patch('/api/profile', { name });
      toast.success('Profile updated successfully');
      fetchProfile();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (newPassword.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }

    try {
      setSaving(true);
      await axios.post('/api/profile/password', { newPassword });
      toast.success('Password changed successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Password change failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingImage(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Math.random()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('profiles')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profiles')
        .getPublicUrl(filePath);

      // Update Profile
      await axios.patch('/api/profile', { avatar_url: publicUrl });
      toast.success('Profile image updated');
      fetchProfile();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#f8fafc]">
      <header className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="h-14 px-7 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <User className="text-slate-900" size={18} />
            <h1 className="text-base text-slate-900 ui-strong">User Profile</h1>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <main className="max-w-5xl mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row gap-8">
          
          {/* Sidebar */}
          <aside className="w-full md:w-64 space-y-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500 mb-3">Profile Sections</p>
              <button
                type="button"
                onClick={() => setActiveTab('general')}
                aria-current={activeTab === 'general' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-3xl text-sm font-medium transition-colors ${ activeTab === 'general' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50' }`}
              >
                <User size={18} />
                General
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                aria-current={activeTab === 'settings' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-3xl text-sm transition-colors ${ activeTab === 'settings' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50' } ui-label`}
              >
                <Shield size={18} />
                Security
              </button>
            </div>
          </aside>

          {/* Content */}
          <div className="flex-1 space-y-6">
            
            {activeTab === 'general' && (
              <form onSubmit={(e) => { e.preventDefault(); handleUpdateProfile(); }} className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="p-8 border-b border-slate-100">
                  <h2 className="text-xl text-slate-900 ui-strong">Account Profile</h2>
                  <p className="text-sm text-slate-500">Manage your public information and identity.</p>
                </div>

                <div className="p-8 space-y-8">
                  {/* Avatar Section */}
                  <div className="flex flex-col lg:flex-row items-start gap-8">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-3xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-3xl text-slate-400 transition-colors ui-strong">
                        {user?.avatar_url ? (
                          <img src={user.avatar_url} alt={`${user?.name} avatar`} className="w-full h-full object-cover" />
                        ) : (
                          user?.name?.charAt(0).toUpperCase()
                        )}
                      </div>
                      <label className="absolute -bottom-2 -right-2 w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors border-2 border-white">
                        <Camera size={18} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                      </label>
                      {uploadingImage && (
                        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-3xl flex items-center justify-center">
                          <Loader2 className="animate-spin text-slate-900" size={24} />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 max-w-xl">
                      <h3 className="text-lg text-slate-900 ui-strong">Profile Photo</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">
                        Upload a high-resolution picture. JPG or PNG only, max 2MB.
                      </p>
                    </div>
                  </div>

                  {/* Form */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 ml-1">Full Name</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-slate-100 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-500 ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                        <input
                          type="email"
                          value={user?.email}
                          disabled
                          className="w-full bg-slate-100 border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium text-slate-400 cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={saving || !name.trim()}
                      className="flex items-center gap-2 bg-slate-950 text-white px-6 py-3 rounded-xl text-sm hover:bg-slate-800 transition-colors disabled:opacity-50 ui-label"
                    >
                      {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Security Card */}
                <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                  <div className="p-8 border-b border-slate-100">
                    <h2 className="text-xl text-slate-900 ui-strong">Security</h2>
                    <p className="text-sm text-slate-500">Protect your account with a strong password.</p>
                  </div>

                  <div className="p-8 space-y-6">
                    <div className="space-y-4 max-w-md">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-500 ml-1">New Password</label>
                        <div className="relative">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Min 6 characters"
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-slate-100 transition-colors"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-500 ml-1">Confirm New Password</label>
                        <div className="relative">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-slate-100 transition-colors"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 flex justify-end">
                      <button
                        type="submit"
                        disabled={saving || !newPassword || newPassword !== confirmPassword}
                        className="flex items-center gap-2 bg-slate-950 text-white px-6 py-3 rounded-xl text-sm hover:bg-slate-800 transition-colors disabled:opacity-50 ui-label"
                      >
                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Shield size={18} />}
                        Update Password
                      </button>
                    </div>
                  </div>
                </form>

                {/* Info Card */}
                <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 flex items-start gap-4">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <h4 className="text-emerald-900 mb-1 ui-strong">Role & Permissions</h4>
                    <p className="text-sm text-emerald-700 leading-relaxed">
                      Your account is currently assigned the <span className="ui-strong">{user?.role || 'Member'}</span> role. Permissions are managed by the administrator and cannot be changed here.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
        </main>
      </div>
    </div>
  );
}
