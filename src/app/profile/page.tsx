'use client';

import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Shield,
  Camera,
  Lock,
  Save,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { useUser } from '@/components/layout/DashboardLayout';
import { PageShell, PageLoadingState } from '@/components/layout/PageShell';
import {
  SettingsLayout,
  SettingsCard,
  SettingsField,
  settingsInputClass,
} from '@/components/admin/AdminUi';
import axios from 'axios';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';

function ProfileContent() {
  const { userProfile: user, loadingProfile: loading, refreshProfile: fetchProfile } = useUser();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [name, setName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [resettingReports, setResettingReports] = useState(false);

  const supabase = createClient();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') setActiveTab('settings');
  }, [searchParams]);

  useEffect(() => {
    if (user) setName(user.name || '');
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
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match');
    if (newPassword.length < 6) return toast.error('Password must be at least 6 characters');

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

  async function handleResetReportDefaults() {
    try {
      setResettingReports(true);
      await axios.patch('/api/profile/report-preferences', { reset: true }, { withCredentials: true });
      toast.success('Report defaults reset. Open a report page to see role defaults.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setResettingReports(false);
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

      const { error: uploadError } = await supabase.storage.from('profiles').upload(filePath, file);
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('profiles').getPublicUrl(filePath);

      await axios.patch('/api/profile', { avatar_url: publicUrl });
      toast.success('Profile image updated');
      fetchProfile();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  }

  if (loading) return <PageLoadingState label="Loading profile..." />;

  const saveButton = (label: string, icon: React.ReactNode, disabled: boolean, onClick?: () => void) => (
    <button
      type="submit"
      disabled={disabled || saving}
      className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 ui-label"
      onClick={onClick}
    >
      {saving ? <Loader2 className="animate-spin" size={14} /> : icon}
      {label}
    </button>
  );

  return (
    <PageShell
      title="Profile Settings"
      subtitle={user?.email}
      icon={<User size={16} />}
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-slate-50 custom-scrollbar"
    >
      <SettingsLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { id: 'general', label: 'General', icon: <User size={14} /> },
          { id: 'settings', label: 'Security', icon: <Shield size={14} /> },
        ]}
      >
        {activeTab === 'general' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUpdateProfile();
            }}
          >
            <SettingsCard
              title="Account profile"
              description="Your name and photo appear across the portal."
              footer={saveButton('Save changes', <Save size={14} />, !name.trim())}
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="relative flex-shrink-0">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-2xl text-slate-400 ui-strong">
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      user?.name?.charAt(0).toUpperCase()
                    )}
                  </div>
                  <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-2 border-white bg-slate-900 text-white hover:bg-slate-800">
                    <Camera size={14} />
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                    />
                  </label>
                  {uploadingImage && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
                      <Loader2 className="animate-spin text-slate-900" size={20} />
                    </div>
                  )}
                </div>

                <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                  <SettingsField label="Full name">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={settingsInputClass()}
                    />
                  </SettingsField>
                  <SettingsField label="Email address">
                    <input type="email" value={user?.email} disabled className={settingsInputClass(true)} />
                  </SettingsField>
                  <SettingsField label="Role">
                    <input
                      type="text"
                      value={user?.role || 'Member'}
                      disabled
                      className={settingsInputClass(true)}
                    />
                  </SettingsField>
                </div>
              </div>
            </SettingsCard>
          </form>
        )}

        {activeTab === 'general' && (
          <SettingsCard
            title="Report workspace"
            description="Clears saved filters, columns, and last report. Role defaults apply next time you open MIS or Distribution."
          >
            <button
              type="button"
              disabled={resettingReports}
              onClick={() => void handleResetReportDefaults()}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 ui-label"
            >
              {resettingReports ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
              Reset my report defaults
            </button>
          </SettingsCard>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleChangePassword();
              }}
            >
              <SettingsCard
                title="Password"
                description="Use at least 6 characters. You will stay signed in after updating."
                footer={saveButton(
                  'Update password',
                  <Shield size={14} />,
                  !newPassword || newPassword !== confirmPassword
                )}
              >
                <div className="grid max-w-md grid-cols-1 gap-4">
                  <SettingsField label="New password">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className={settingsInputClass()}
                    />
                  </SettingsField>
                  <SettingsField label="Confirm password">
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={settingsInputClass()}
                    />
                  </SettingsField>
                </div>
              </SettingsCard>
            </form>

            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs text-emerald-900 ui-strong">Role & permissions</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700">
                  Your account has the <span className="font-semibold">{user?.role || 'Member'}</span> role.
                  Branch and report access are managed by an administrator.
                </p>
              </div>
            </div>
          </div>
        )}
      </SettingsLayout>
    </PageShell>
  );
}

export default function ProfilePage() {
  return (
    <React.Suspense fallback={<PageLoadingState label="Loading profile..." />}>
      <ProfileContent />
    </React.Suspense>
  );
}
