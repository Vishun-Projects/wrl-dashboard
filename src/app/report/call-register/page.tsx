import React from 'react';
import { Metadata } from 'next';
import { CallRegisterClient } from './call-register-client';

export const metadata: Metadata = {
  title: 'Call Register | Reports',
};

export default function CallRegisterPage() {
  return <CallRegisterClient />;
}
