'use client';

import { useSyncExternalStore } from 'react';
import { feedback } from '@/lib/ui/feedback';

export type MisEmailSendJobClientStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type MisEmailSendJobClient = {
  jobId: string;
  toastId: string | number;
  status: MisEmailSendJobClientStatus;
  message: string;
  createdAt: number;
};

export type MisEmailSendFinished = {
  ok: boolean;
  message: string;
  finishedAt: number;
};

const STORAGE_KEY = 'mis-email-send-jobs-v1';

type StoreSnapshot = {
  activeJobs: MisEmailSendJobClient[];
  lastFinished: MisEmailSendFinished | null;
};

const EMPTY_SNAPSHOT: StoreSnapshot = { activeJobs: [], lastFinished: null };

let activeJobs: MisEmailSendJobClient[] = [];
let lastFinished: MisEmailSendFinished | null = null;
let snapshot: StoreSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function publishSnapshot(): void {
  snapshot = { activeJobs, lastFinished };
}

function emit(): void {
  publishSnapshot();
  listeners.forEach((listener) => listener());
}

function readStorage(): MisEmailSendJobClient[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MisEmailSendJobClient[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(jobs: MisEmailSendJobClient[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (jobs.length === 0) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // ignore quota / private mode
  }
}

function setActiveJobs(next: MisEmailSendJobClient[]): void {
  activeJobs = next;
  writeStorage(next);
  emit();
}

function hydrateFromStorage(): void {
  activeJobs = readStorage();
  publishSnapshot();
}

function getSnapshot(): StoreSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined') {
  hydrateFromStorage();
}

export function trackMisEmailSendJob(jobId: string, message = 'Sending MIS email…'): void {
  if (activeJobs.some((job) => job.jobId === jobId)) return;

  const toastId = feedback.loading(message);
  const job: MisEmailSendJobClient = {
    jobId,
    toastId,
    status: 'queued',
    message,
    createdAt: Date.now(),
  };

  setActiveJobs([...activeJobs, job]);
}

export function updateMisEmailSendJobClient(
  jobId: string,
  patch: Partial<Pick<MisEmailSendJobClient, 'status' | 'message'>>
): void {
  const index = activeJobs.findIndex((job) => job.jobId === jobId);
  if (index < 0) return;

  const next = [...activeJobs];
  next[index] = { ...next[index], ...patch };
  setActiveJobs(next);

  if (patch.message) {
    feedback.loadingUpdate(next[index].toastId, patch.message);
  }
}

export function finishMisEmailSendJobClient(
  jobId: string,
  result: { ok: boolean; message: string; error?: string }
): void {
  const job = activeJobs.find((item) => item.jobId === jobId);
  if (!job) return;

  if (result.ok) {
    feedback.loadingSuccess(job.toastId, result.message);
  } else {
    feedback.loadingFailed(job.toastId, result.message, {
      description: result.error,
    });
  }

  lastFinished = {
    ok: result.ok,
    message: result.message,
    finishedAt: Date.now(),
  };
  setActiveJobs(activeJobs.filter((item) => item.jobId !== jobId));
}

export function clearMisEmailSendFinished(): void {
  if (lastFinished === null) return;
  lastFinished = null;
  emit();
}

export function reattachMisEmailSendToasts(): void {
  if (activeJobs.length === 0) return;
  setActiveJobs(
    activeJobs.map((job) => ({
      ...job,
      toastId: feedback.loading(job.message || 'Sending MIS email…'),
    }))
  );
}

export function useMisEmailSendJobs(): StoreSnapshot & {
  hasActiveSend: boolean;
  clearLastFinished: () => void;
} {
  const store = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);

  return {
    activeJobs: store.activeJobs,
    lastFinished: store.lastFinished,
    hasActiveSend: store.activeJobs.length > 0,
    clearLastFinished: clearMisEmailSendFinished,
  };
}

export function getMisEmailSendJobsSnapshot(): StoreSnapshot {
  return getSnapshot();
}
