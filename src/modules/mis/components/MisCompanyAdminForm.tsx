'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronUp, Loader2, Save } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { MisClientSourceConfig } from '@/modules/mis/client-import';
import type { SourceConfigPayload } from '@/modules/mis/client-import';

const CRM_FIELDS = [
  'logged_at',
  'solved_at',
  'status_label',
  'region',
  'state',
  'branch_name',
  'complaint',
  'call_type',
  'engineer_name',
] as const;

const STATUS_BUCKETS = [
  'open_unallocated',
  'assigned',
  'tech_solved',
  'solved',
  'cancelled',
] as const;

const ZONES = ['NORTH', 'EAST', 'WEST', 'SOUTH'] as const;

type Props = {
  canEdit: boolean;
  onSaved: () => void;
};

function emptyPayload(): SourceConfigPayload {
  return {
    code: '',
    name: '',
    file_kind: 'csv',
    delimiter: '|',
    header_row_index: 0,
    call_key_column: '',
    crm_account_filter: null,
    fieldMappings: [{ client_column: '', crm_field: 'logged_at', transform: null }],
    statusMappings: [{ client_status: '', status_bucket: 'assigned', status_label: 'Assigned' }],
    stateMappings: [{ client_state: '', plan_code: null, region_override: null }],
  };
}

export default function MisCompanyAdminForm({ canEdit, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Array<{ code: string; name: string }>>([]);
  const [editCode, setEditCode] = useState('');
  const [payload, setPayload] = useState<SourceConfigPayload>(emptyPayload);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const res = await axios.get<{ sources: Array<{ code: string; name: string }> }>(
        '/api/mis-client-import/sources',
        { withCredentials: true }
      );
      setSources(res.data.sources ?? []);
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    if (open) void loadSources();
  }, [open, loadSources]);

  const loadConfig = async (code: string) => {
    if (!code) {
      setPayload(emptyPayload());
      return;
    }
    try {
      const res = await axios.get<{ config: MisClientSourceConfig }>(
        `/api/mis-client-import/sources/${encodeURIComponent(code)}`,
        { withCredentials: true }
      );
      const c = res.data.config;
      setPayload({
        code: c.code,
        name: c.name,
        file_kind: c.file_kind,
        delimiter: c.delimiter,
        header_row_index: c.header_row_index,
        call_key_column: c.call_key_column,
        crm_account_filter: c.crm_account_filter,
        fieldMappings: c.fieldMappings.length
          ? c.fieldMappings
          : [{ client_column: '', crm_field: 'logged_at', transform: null }],
        statusMappings: c.statusMappings.length
          ? c.statusMappings
          : [{ client_status: '', status_bucket: 'assigned', status_label: 'Assigned' }],
        stateMappings: c.stateMappings.length
          ? c.stateMappings
          : [{ client_state: '', plan_code: null, region_override: null }],
      });
    } catch {
      setMessage('Failed to load source config');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body = editCode
        ? { ...payload, code: editCode }
        : payload;
      if (editCode) {
        await axios.put(
          `/api/mis-client-import/sources/${encodeURIComponent(editCode)}`,
          body,
          { withCredentials: true }
        );
      } else {
        await axios.post('/api/mis-client-import/sources', body, { withCredentials: true });
      }
      setMessage('Saved.');
      await loadSources();
      onSaved();
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Save failed';
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-bg-canvas shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-slate-800"
      >
        Add / edit company
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3 text-[11px]">
          <p className="text-[10px] text-slate-500">
            Coke = Excel CDMS (
            <code className="text-slate-600">Call No</code>, <code className="text-slate-600">Entity Name</code>, …).
            Cadbury = VMS pipe CSV (
            <code className="text-slate-600">VMSComplaintDetailsRpt.csv</code>,{' '}
            <code className="text-slate-600">.TicketNumber</code>,{' '}
            <code className="text-slate-600">VDate</code>, …) or Excel.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">Edit existing</span>
              <FilterSelect
                label="Company"
                emptyLabel="— New company —"
                mode="single"
                options={sources.map((s) => ({
                  value: s.code,
                  label: `${s.code} — ${s.name}`,
                }))}
                selected={editCode ? [editCode] : []}
                onChange={(values) => {
                  const code = values[0] ?? '';
                  setEditCode(code);
                  void loadConfig(code);
                }}
                panelClassName="w-72"
              />
            </label>
            {editCode ? (
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-500">Source code</span>
                <input
                  value={editCode}
                  readOnly
                  className="w-28 rounded border border-slate-200 bg-bg-soft px-2 py-1 text-slate-600"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-500">Code</span>
                <input
                  value={payload.code}
                  onChange={(e) => setPayload({ ...payload, code: e.target.value })}
                  className="rounded border border-slate-200 px-2 py-1 w-28"
                  placeholder="coke"
                />
              </label>
            )}
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">Display name</span>
              <input
                value={payload.name}
                onChange={(e) => setPayload({ ...payload, name: e.target.value })}
                className="rounded border border-slate-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">File type</span>
              <FilterSelect
                label="File type"
                emptyLabel="File type"
                mode="single"
                options={[
                  { value: 'csv', label: 'CSV' },
                  { value: 'xlsx', label: 'Excel' },
                ]}
                selected={[payload.file_kind]}
                onChange={(values) =>
                  setPayload({
                    ...payload,
                    file_kind: (values[0] ?? 'csv') as 'csv' | 'xlsx',
                  })
                }
                panelClassName="w-44"
              />
            </label>
            {payload.file_kind === 'csv' && (
              <label className="flex flex-col gap-0.5">
                <span className="text-slate-500">Delimiter</span>
                <input
                  value={payload.delimiter ?? ''}
                  onChange={(e) => setPayload({ ...payload, delimiter: e.target.value })}
                  className="rounded border border-slate-200 px-2 py-1 w-16"
                />
              </label>
            )}
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">Header row #</span>
              <input
                type="number"
                min={0}
                value={payload.header_row_index}
                onChange={(e) =>
                  setPayload({ ...payload, header_row_index: Number(e.target.value) })
                }
                className="rounded border border-slate-200 px-2 py-1 w-20"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">Call key column</span>
              <input
                value={payload.call_key_column}
                onChange={(e) => setPayload({ ...payload, call_key_column: e.target.value })}
                className="rounded border border-slate-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">CRM account filter</span>
              <input
                value={payload.crm_account_filter ?? ''}
                onChange={(e) =>
                  setPayload({ ...payload, crm_account_filter: e.target.value || null })
                }
                className="rounded border border-slate-200 px-2 py-1"
                placeholder="COKE"
              />
            </label>
          </div>

          <div>
            <p className="mb-1 font-medium text-slate-700">Column mappings</p>
            <div className="space-y-1">
              {payload.fieldMappings.map((m, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input
                    value={m.client_column}
                    onChange={(e) => {
                      const fieldMappings = [...payload.fieldMappings];
                      fieldMappings[i] = { ...m, client_column: e.target.value };
                      setPayload({ ...payload, fieldMappings });
                    }}
                    placeholder="Client column"
                    className="rounded border border-slate-200 px-2 py-1 flex-1 min-w-[120px]"
                  />
                  <FilterSelect
                    label="CRM field"
                    emptyLabel="CRM field"
                    mode="single"
                    options={CRM_FIELDS.map((f) => ({ value: f, label: f }))}
                    selected={[m.crm_field]}
                    onChange={(values) => {
                      const fieldMappings = [...payload.fieldMappings];
                      fieldMappings[i] = { ...m, crm_field: values[0] ?? m.crm_field };
                      setPayload({ ...payload, fieldMappings });
                    }}
                    panelClassName="w-44"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPayload({
                        ...payload,
                        fieldMappings: payload.fieldMappings.filter((_, j) => j !== i),
                      })
                    }
                    className="text-rose-600 text-[10px]"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPayload({
                    ...payload,
                    fieldMappings: [
                      ...payload.fieldMappings,
                      { client_column: '', crm_field: 'logged_at', transform: null },
                    ],
                  })
                }
                className="text-indigo-600 text-[10px] hover:underline"
              >
                + Add column mapping
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 font-medium text-slate-700">Status mappings</p>
            <div className="space-y-1">
              {payload.statusMappings.map((m, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input
                    value={m.client_status}
                    onChange={(e) => {
                      const statusMappings = [...payload.statusMappings];
                      statusMappings[i] = { ...m, client_status: e.target.value };
                      setPayload({ ...payload, statusMappings });
                    }}
                    placeholder="Client status"
                    className="rounded border border-slate-200 px-2 py-1 flex-1 min-w-[100px]"
                  />
                  <FilterSelect
                    label="Status bucket"
                    emptyLabel="Status bucket"
                    mode="single"
                    options={STATUS_BUCKETS.map((b) => ({ value: b, label: b }))}
                    selected={[m.status_bucket]}
                    onChange={(values) => {
                      const statusMappings = [...payload.statusMappings];
                      statusMappings[i] = {
                        ...m,
                        status_bucket: (values[0] ?? m.status_bucket) as (typeof STATUS_BUCKETS)[number],
                      };
                      setPayload({ ...payload, statusMappings });
                    }}
                    panelClassName="w-44"
                  />
                  <input
                    value={m.status_label}
                    onChange={(e) => {
                      const statusMappings = [...payload.statusMappings];
                      statusMappings[i] = { ...m, status_label: e.target.value };
                      setPayload({ ...payload, statusMappings });
                    }}
                    placeholder="Label"
                    className="rounded border border-slate-200 px-2 py-1 w-28"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPayload({
                    ...payload,
                    statusMappings: [
                      ...payload.statusMappings,
                      { client_status: '', status_bucket: 'assigned', status_label: 'Assigned' },
                    ],
                  })
                }
                className="text-indigo-600 text-[10px] hover:underline"
              >
                + Add status mapping
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 font-medium text-slate-700">State / entity → zone</p>
            <div className="space-y-1">
              {payload.stateMappings.map((m, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input
                    value={m.client_state}
                    onChange={(e) => {
                      const stateMappings = [...payload.stateMappings];
                      stateMappings[i] = { ...m, client_state: e.target.value };
                      setPayload({ ...payload, stateMappings });
                    }}
                    placeholder="Entity / state"
                    className="rounded border border-slate-200 px-2 py-1 flex-1 min-w-[120px]"
                  />
                  <FilterSelect
                    label="Zone"
                    emptyLabel="— zone —"
                    mode="single"
                    options={ZONES.map((z) => ({ value: z, label: z }))}
                    selected={m.region_override ? [m.region_override] : []}
                    onChange={(values) => {
                      const stateMappings = [...payload.stateMappings];
                      stateMappings[i] = {
                        ...m,
                        region_override: values[0] || null,
                      };
                      setPayload({ ...payload, stateMappings });
                    }}
                    panelClassName="w-44"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPayload({
                    ...payload,
                    stateMappings: [
                      ...payload.stateMappings,
                      { client_state: '', plan_code: null, region_override: null },
                    ],
                  })
                }
                className="text-indigo-600 text-[10px] hover:underline"
              >
                + Add state mapping
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save company
            </button>
            {message && <span className="text-slate-600">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
