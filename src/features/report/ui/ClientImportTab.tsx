'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import MisClientImportToolbar from '@/features/report/ui/MisClientImportToolbar';
import MisSourceCheckboxes from '@/features/report/ui/MisSourceCheckboxes';
import MisCompanyAdminForm from '@/features/report/ui/MisCompanyAdminForm';
import type { MisSourceSelection } from '@/features/mis-import';
import { saveMisSourceSelection } from '@/features/mis-import';

type Props = {
  uploadSource: string;
  sourceSelection: MisSourceSelection;
  dateScope: { startDate: string; endDate: string };
  metaRefreshKey: number;
  onUploadSourceChange: (code: string) => void;
  onSourceSelectionChange: (selection: MisSourceSelection) => void;
  onImportComplete: () => void;
};

export default function ClientImportTab({
  uploadSource,
  sourceSelection,
  dateScope,
  metaRefreshKey,
  onUploadSourceChange,
  onSourceSelectionChange,
  onImportComplete,
}: Props) {
  const [activeSources, setActiveSources] = useState<Array<{ code: string; name: string }>>([]);
  const [canManageImports, setCanManageImports] = useState(false);

  const loadSources = useCallback(async () => {
    try {
      const [sourcesRes, metaRes] = await Promise.all([
        axios.get<{ sources: Array<{ code: string; name: string }> }>(
          '/api/mis-client-import/sources',
          { withCredentials: true }
        ),
        axios.get<{ canUpload?: boolean }>('/api/mis-client-import/meta', {
          withCredentials: true,
        }),
      ]);
      setActiveSources(sourcesRes.data.sources ?? []);
      setCanManageImports(Boolean(metaRes.data.canUpload));
    } catch {
      setActiveSources([]);
      setCanManageImports(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources, metaRefreshKey]);

  const handleSourceChange = (selection: MisSourceSelection) => {
    saveMisSourceSelection(selection);
    onSourceSelectionChange(selection);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-soft/10 inner-scrollbar">
      <div className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Client file import</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Upload Coke, Cadbury, or other client MIS files. Manage past uploads in the history
            below. Summary and Key Account tabs follow the source checkboxes.
          </p>
        </div>

        <MisSourceCheckboxes
          selection={sourceSelection}
          activeSources={activeSources}
          onChange={handleSourceChange}
        />

        <MisClientImportToolbar
          uploadSource={uploadSource}
          dateScope={dateScope}
          metaRefreshKey={metaRefreshKey}
          onUploadSourceChange={onUploadSourceChange}
          onImportComplete={() => {
            onImportComplete();
            void loadSources();
          }}
        />

        <MisCompanyAdminForm
          canEdit={canManageImports}
          onSaved={() => {
            void loadSources();
            onImportComplete();
          }}
        />
      </div>
    </div>
  );
}
