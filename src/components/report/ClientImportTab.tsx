'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import MisClientImportToolbar from '@/components/report/MisClientImportToolbar';
import MisSourceCheckboxes from '@/components/report/MisSourceCheckboxes';
import MisCompanyAdminForm from '@/components/report/MisCompanyAdminForm';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import type { MisSourceSelection } from '@/lib/mis-client-import/source-selection';
import { saveMisSourceSelection } from '@/lib/mis-client-import/source-selection';

type Props = {
  email?: string | null;
  uploadSource: string;
  sourceSelection: MisSourceSelection;
  dateScope: { startDate: string; endDate: string };
  metaRefreshKey: number;
  onUploadSourceChange: (code: string) => void;
  onSourceSelectionChange: (selection: MisSourceSelection) => void;
  onImportComplete: () => void;
};

export default function ClientImportTab({
  email,
  uploadSource,
  sourceSelection,
  dateScope,
  metaRefreshKey,
  onUploadSourceChange,
  onSourceSelectionChange,
  onImportComplete,
}: Props) {
  const [activeSources, setActiveSources] = useState<Array<{ code: string; name: string }>>([]);
  const canUpload = canUploadClientMis(email);

  const loadSources = useCallback(async () => {
    try {
      const res = await axios.get<{ sources: Array<{ code: string; name: string }> }>(
        '/api/mis-client-import/sources',
        { withCredentials: true }
      );
      setActiveSources(res.data.sources ?? []);
    } catch {
      setActiveSources([]);
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/10 inner-scrollbar">
      <div className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Client file import</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Upload Coke, Cadbury, or other client MIS files. Summary and Key Account tabs use the
            source checkboxes below.
          </p>
        </div>

        <MisSourceCheckboxes
          selection={sourceSelection}
          activeSources={activeSources}
          onChange={handleSourceChange}
        />

        <MisClientImportToolbar
          email={email}
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
          canEdit={canUpload}
          onSaved={() => {
            void loadSources();
            onImportComplete();
          }}
        />
      </div>
    </div>
  );
}
