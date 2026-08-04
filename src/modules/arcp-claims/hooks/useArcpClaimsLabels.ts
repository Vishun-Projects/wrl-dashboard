'use client';

import { useEffect, useMemo, useState } from 'react';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type ChunkedFetchAuth } from '@/lib/supabase/chunked-fetch';
import { fetchReadModelStatus } from '@/lib/read-model/trigger-sync-client';
import { type ArcpPostgresCoverage } from '@/modules/arcp-claims/server/sync/coverage-shared';
import { type ArcpClientLabelLookups } from '@/modules/arcp-claims/services/labels';

export interface UseArcpClaimsLabelsProps {
  supabase: SupabaseClient;
  chunkedAuth: ChunkedFetchAuth;
  resourcesLoaded: boolean;
  callTypeOptions: Array<{ value: string | number; label: string }>;
}

export function useArcpClaimsLabels({
  supabase,
  chunkedAuth,
  resourcesLoaded,
  callTypeOptions,
}: UseArcpClaimsLabelsProps) {
  const [arcpCoverage, setArcpCoverage] = useState<ArcpPostgresCoverage | null>(null);
  const [arcpCrmLabelLookups, setArcpCrmLabelLookups] = useState<ArcpClientLabelLookups | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const progress = await fetchReadModelStatus(session?.access_token);
        if (!cancelled) setArcpCoverage(progress.arcp ?? null);
      } catch {
        /* status optional for estimates */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!resourcesLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const lookups = await chunkedAuth.getWithAuthRetry<ArcpClientLabelLookups>(
          '/api/report/arcp-claims/label-lookups'
        );
        if (!cancelled) setArcpCrmLabelLookups(lookups);
      } catch {
        /* labels optional — table falls back to codes */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resourcesLoaded, chunkedAuth]);

  const arcpLabelLookups = useMemo(() => {
    const callTypeLabelsByCode: Record<string, string> = {
      ...(arcpCrmLabelLookups?.callTypeLabelsByCode ?? {}),
    };
    for (const option of callTypeOptions) {
      if (option.value && option.label) {
        callTypeLabelsByCode[String(option.value)] = option.label;
      }
    }
    return {
      callTypeLabelsByCode,
      itemCategoryLabelsByCode: arcpCrmLabelLookups?.itemCategoryLabelsByCode ?? {},
    };
  }, [callTypeOptions, arcpCrmLabelLookups]);

  return {
    arcpCoverage,
    setArcpCoverage,
    arcpCrmLabelLookups,
    arcpLabelLookups,
  };
}
