import React from 'react';
import { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessMisTab } from '@/lib/auth/rbac-catalog';
import { CallRegisterClient } from '@/modules/mis/pages/CallRegisterPageClient';

export const metadata: Metadata = {
  title: 'Call Register | Reports',
};

export default async function CallRegisterPage() {
  const userInfo = await getUserInfo();
  if (!userInfo) redirect('/login');
  if (!canAccessMisTab(userInfo.permissions, 'deployment_completion')) notFound();
  return <CallRegisterClient />;
}
