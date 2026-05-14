'use client';

import React from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';

export function FlaggingDisclaimer() {
  return (
    <div className="bg-[#fffbeb] border border-[#fef3c7] rounded-2xl p-5 flex gap-4 shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-[#fef3c7] flex items-center justify-center shrink-0">
        <ShieldAlert size={24} className="text-[#92400e]" />
      </div>
      <div>
        <h4 className="text-[14px] font-bold text-[#92400e]">Administrative Data Governance</h4>
        <p className="text-[12px] text-[#b45309] leading-relaxed mt-1">
          Modifying user roles and branch assignments directly impacts audit integrity and data visibility across the Fast-Close Portal. 
          Changes made here are logged and will restrict user access to historical CRM records immediately. 
          Please verify email addresses before provisioning new accounts to prevent duplicate profiles.
        </p>
      </div>
    </div>
  );
}
