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
  Palette,
  FileSpreadsheet,
} from 'lucide-react';
import { useUser } from '@/components/layout/DashboardLayout';
import { PageShell } from '@/components/layout/PageShell';
import { FormSkeleton } from '@/components/ui/DataTableLoading';
import {
  SettingsLayout,
  SettingsCard,
  SettingsField,
  settingsInputClass,
} from '@/components/admin/AdminUi';
import axios from 'axios';
import { feedback } from '@/lib/ui/feedback';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import { ThemePicker } from '@/components/settings/ThemePicker';
import type { MisEmailPreferences } from '@/lib/mis-email/preferences';

type MisEmailSettings = {
  mis_email_enabled: boolean;
  preferences: MisEmailPreferences;
  allowed: {
    includeSummary: boolean;
    includeDetailed: boolean;
    includeKeyAccount: boolean;
  };
  roleName: string | null;
  scopeLabel: string | null;
};

function ProfileContent() {
  const { userProfile: user, loadingProfile: loading, refreshProfile: fetchProfile } = useUser();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [name, setName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailSettings, setEmailSettings] = useState<MisEmailSettings | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailPrefs, setEmailPrefs] = useState<MisEmailPreferences>({});

  const supabase = createClient();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') setActiveTab('settings');
    if (tab === 'appearance') setActiveTab('appearance');
  }, [searchParams]);

  useEffect(() => {
    if (user) setName(user.name || '');
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    void loadEmailSettings();
  }, [user?.id]);

  async function loadEmailSettings() {
    setEmailLoading(true);
    try {
      const res = await axios.get('/api/profile/mis-email', { withCredentials: true });
      setEmailSettings(res.data);
      setEmailPrefs(res.data.preferences ?? {});
    } catch {
      feedback.actionFailed('Failed to load email report settings');
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleSaveEmailPrefs() {
    setEmailSaving(true);
    try {
      const res = await axios.patch('/api/profile/mis-email', emailPrefs, { withCredentials: true });
      setEmailPrefs(res.data.preferences ?? emailPrefs);
      feedback.actionSuccess('Email report preferences saved');
      await loadEmailSettings();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Save failed');
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleUpdateProfile() {
    try {
      setSaving(true);
      await axios.patch('/api/profile', { name });
      feedback.actionSuccess('Profile updated successfully');
      fetchProfile();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    setPasswordError(null);

    try {
      setSaving(true);
      await axios.post('/api/profile/password', { newPassword });
      feedback.actionSuccess('Password changed successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Password change failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      feedback.actionFailed('Please upload a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      feedback.actionFailed('Image must be 2 MB or smaller.');
      return;
    }

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
      feedback.actionSuccess('Profile image updated');
      fetchProfile();
    } catch (err: any) {
      feedback.actionFailed(err.message || 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  }

  if (loading) {
    return (
      <PageShell
        title="Profile Settings"
        icon={<User size={16} />}
        bodyClassName="min-h-0 flex-1 overflow-y-auto bg-bg-soft custom-scrollbar"
      >
        <FormSkeleton fields={5} />
      </PageShell>
    );
  }

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
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-bg-soft custom-scrollbar"
    >
      <SettingsLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { id: 'general', label: 'General', icon: <User size={14} /> },
          { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
          ...(emailSettings?.mis_email_enabled
            ? [{ id: 'email', label: 'Email reports', icon: <Mail size={14} /> }]
            : []),
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
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-bg-canvas/80">
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

            {!emailLoading && emailSettings && !emailSettings.mis_email_enabled ? (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-bg-soft px-4 py-3">
                <Mail size={18} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-800 ui-strong">MIS email reports</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    Contact your administrator to enable scheduled MIS email reports for your account.
                  </p>
                </div>
              </div>
            ) : null}
          </form>
        )}

        {activeTab === 'email' && emailSettings?.mis_email_enabled ? (
          <SettingsCard
            title="MIS email reports"
            description="Daily digest sent at 7:00 AM IST. Data matches your portal branch and report access."
            footer={
              <button
                type="button"
                disabled={emailSaving}
                onClick={() => void handleSaveEmailPrefs()}
                className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 ui-label"
              >
                {emailSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                Save preferences
              </button>
            }
          >
            {emailLoading ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-3 rounded-lg border border-slate-100 bg-bg-soft/60 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Role</p>
                    <p className="mt-1 text-[13px] text-slate-800">{emailSettings.roleName || user?.role}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Branch scope</p>
                    <p className="mt-1 text-[13px] text-slate-800">
                      {emailSettings.scopeLabel || 'All branches'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Receive emails</p>
                    <p className="text-[11px] text-slate-500">Turn off to pause digests without losing settings.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEmailPrefs((prev) => ({
                        ...prev,
                        subscribed: prev.subscribed === false,
                      }))
                    }
                    className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                      emailPrefs.subscribed !== false ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        emailPrefs.subscribed !== false ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-[12px] font-medium text-slate-800">Report period</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { id: 'yesterday', label: 'Yesterday only' },
                      { id: 'month_to_date', label: 'Month to date (1st → today)' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setEmailPrefs((prev) => ({
                            ...prev,
                            dateRange: opt.id as MisEmailPreferences['dateRange'],
                          }))
                        }
                        className={`rounded-lg border px-3 py-2.5 text-left text-[12px] transition-colors ${
                          (emailPrefs.dateRange ?? 'month_to_date') === opt.id
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[12px] font-medium text-slate-800 flex items-center gap-1.5">
                    <FileSpreadsheet size={14} className="text-slate-400" />
                    Attachments
                  </p>
                  <div className="space-y-2">
                    {emailSettings.allowed.includeSummary ? (
                      <label className="flex items-center gap-2 text-[12px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={emailPrefs.includeSummary !== false}
                          onChange={(e) =>
                            setEmailPrefs((prev) => ({ ...prev, includeSummary: e.target.checked }))
                          }
                        />
                        Summary report
                      </label>
                    ) : null}
                    {emailSettings.allowed.includeDetailed ? (
                      <label className="flex items-center gap-2 text-[12px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={emailPrefs.includeDetailed !== false}
                          onChange={(e) =>
                            setEmailPrefs((prev) => ({ ...prev, includeDetailed: e.target.checked }))
                          }
                        />
                        Detailed register
                      </label>
                    ) : null}
                    {emailSettings.allowed.includeKeyAccount ? (
                      <label className="flex items-center gap-2 text-[12px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={emailPrefs.includeKeyAccount !== false}
                          onChange={(e) =>
                            setEmailPrefs((prev) => ({ ...prev, includeKeyAccount: e.target.checked }))
                          }
                        />
                        Key accounts
                      </label>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </SettingsCard>
        ) : null}

        {activeTab === 'appearance' && (
          <SettingsCard
            title="Color theme"
            description="Choose how the portal looks on this device. Your choice is saved to your profile."
          >
            <ThemePicker />
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
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (passwordError) setPasswordError(null);
                      }}
                      placeholder="Min 6 characters"
                      className={settingsInputClass()}
                    />
                  </SettingsField>
                  <SettingsField label="Confirm password">
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (passwordError) setPasswordError(null);
                      }}
                      className={settingsInputClass()}
                    />
                  </SettingsField>
                  {passwordError ? (
                    <p className="text-xs text-red-600">{passwordError}</p>
                  ) : null}
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
    <React.Suspense
      fallback={
        <PageShell
          title="Profile Settings"
          icon={<User size={16} />}
          bodyClassName="min-h-0 flex-1 overflow-y-auto bg-bg-soft custom-scrollbar"
        >
          <FormSkeleton fields={5} />
        </PageShell>
      }
    >
      <ProfileContent />
    </React.Suspense>
  );
}
