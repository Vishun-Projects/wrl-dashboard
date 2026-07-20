'use client';

import React, { memo } from 'react';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { TruncatedText } from '@/components/ui/TruncatedText';
import type { CallRegisterRow } from '@/lib/report/call-register/types';

type CallRegisterGridProps = {
  rows: CallRegisterRow[];
  onClientClick?: (client: string) => void;
};

export const CallRegisterGrid = memo(function CallRegisterGrid({
  rows,
  onClientClick,
}: CallRegisterGridProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-500">
        No records found for the selected date range.
      </div>
    );
  }

  return (
    <AdminTable className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[20%]" />
        <col className="w-[12%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[12%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
      </colgroup>
      <AdminThead>
        <tr>
          <AdminTh>Client</AdminTh>
          <AdminTh className="text-right">Billing Count</AdminTh>
          <AdminTh className="text-right">Deployment</AdminTh>
          <AdminTh className="text-right">Installation</AdminTh>
          <AdminTh className="text-center">Service Billing</AdminTh>
          <AdminTh className="text-right">Balance Deploy</AdminTh>
          <AdminTh className="text-right">Balance Install</AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {rows.map((row) => (
          <AdminTr key={row.client} className="hover:bg-bg-soft/80">
            <AdminTd className="font-medium text-slate-800">
              {onClientClick ? (
                <button
                  type="button"
                  onClick={() => onClientClick(row.client)}
                  className="text-left text-blue-700 hover:text-blue-900 hover:underline underline-offset-2"
                >
                  <TruncatedText text={row.client} />
                </button>
              ) : (
                <TruncatedText text={row.client} />
              )}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.qty.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.deployment.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.installation.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-center text-slate-400">
              -
            </AdminTd>
            <AdminTd className="text-right tabular-nums font-semibold text-slate-900">
              {row.balanceDeployment.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums font-semibold text-slate-900">
              {row.balanceInstallation.toLocaleString('en-IN')}
            </AdminTd>
          </AdminTr>
        ))}
      </tbody>
    </AdminTable>
  );
});
