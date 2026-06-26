import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { RegionConfig, WorkspaceInfo, extractErrorMessage } from '../api/client';
import { useToast } from '../components/Toast';

// ─── Unified region type ──────────────────────────────────────────────────────

interface RegionItem {
  id: string;
  workspace_url: string;
  display_name: string;
  sp_client_id: string;
  sql_warehouse_id: string;
  is_primary: boolean;
  slot?: number;
  secret_configured: boolean;
  secret_scope?: string;
  secret_key?: string;
  config_label?: string;
  source?: RegionConfig;
}

// ─── Right-side Drawer ────────────────────────────────────────────────────────

function RightDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 z-50 w-[540px] bg-white dark:bg-gray-800 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-6 py-5 border-b dark:border-gray-700 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className={`shrink-0 px-2 py-1 text-xs rounded border transition-colors ${
        copied
          ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
          : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
      }`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative mt-2">
      <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 dark:text-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap pr-16 leading-relaxed">
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

// ─── Confirm Switch Modal ─────────────────────────────────────────────────────

function ConfirmSwitchModal({
  name,
  url,
  onConfirm,
  onCancel,
}: {
  name: string;
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const host = url.replace(/^https?:\/\//, '');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="shrink-0 w-9 h-9 rounded-full bg-brand-dark/10 dark:bg-brand-dark/30 flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-brand-dark dark:text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">Switch active region?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              All app views will switch to this workspace.
            </p>
          </div>
        </div>

        {/* Target workspace */}
        <div className="mx-6 mb-5 rounded-lg border border-brand-dark/30 dark:border-brand-dark/50 bg-brand-dark/5 dark:bg-brand-dark/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-brand-dark dark:bg-brand shrink-0" />
            <span className="font-semibold text-gray-900 dark:text-white text-sm">{name}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-300 font-mono mt-1 pl-4.5 truncate">{host}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-dark rounded-lg hover:opacity-90 transition-opacity"
          >
            Switch to {name}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Setup Checklist (drawer content) ────────────────────────────────────────

function ChecklistStep({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-dark text-white text-xs font-semibold flex items-center justify-center">
          {num}
        </span>
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 flex-1">{title}</span>
        <svg className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 bg-gray-50 dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300">{children}</div>}
    </div>
  );
}

function SetupChecklistContent({ region }: { region: RegionConfig }) {
  const slot = region.slot;
  const host = region.workspace_url.replace(/^https?:\/\//, '');

  const addSpCmd = `databricks accounts service-principals grant-workspace-access \\
  --service-principal-id ${region.sp_client_id} \\
  --workspace-url ${region.workspace_url}`;

  const secretsCmd = `# Run from CLI connected to the Primary workspace
databricks secrets put-secret \\
  --scope ${region.secret_scope} \\
  --key sec-${slot}-sp-client-id \\
  --string-value "${region.sp_client_id}"

databricks secrets put-secret \\
  --scope ${region.secret_scope} \\
  --key ${region.secret_key}
# (paste the SP client secret — not echoed)`;

  const grantsSQL = `-- Run in: ${region.display_name} SQL editor
-- Repeat for each catalog you want the app to manage

GRANT USE CATALOG ON CATALOG \`<your_catalog>\` TO \`${region.sp_client_id}\`;
GRANT USE SCHEMA  ON CATALOG \`<your_catalog>\` TO \`${region.sp_client_id}\`;
GRANT BROWSE      ON CATALOG \`<your_catalog>\` TO \`${region.sp_client_id}\`;
GRANT APPLY TAG   ON CATALOG \`<your_catalog>\` TO \`${region.sp_client_id}\`;`;

  return (
    <div className="space-y-3">
      <ChecklistStep num={1} title="Create a Service Principal">
        <div className="mt-1 space-y-2">
          <p>Go to <a href="https://accounts.cloud.databricks.com/service-principals" target="_blank"
            rel="noreferrer" className="text-blue-600 hover:underline font-medium">
            accounts.cloud.databricks.com → Service Principals</a> and click <strong>Add service principal</strong>.
          </p>
          <p>SP Client ID saved: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs">{region.sp_client_id}</code></p>
          <p>Click <strong>Secrets → Generate secret</strong>. Copy it immediately — shown only once.</p>
        </div>
      </ChecklistStep>
      <ChecklistStep num={2} title={`Add SP to ${region.display_name}`}>
        <p className="mt-1">Add the SP to the target workspace via account console or CLI:</p>
        <CodeBlock code={addSpCmd} />
        <p className="mt-2 text-xs text-gray-500">Or: account console → Workspaces → {host} → Service Principals → Add.</p>
      </ChecklistStep>
      <ChecklistStep num={3} title="Store credentials in Databricks Secrets">
        <p className="mt-1">Run from a terminal connected to the <strong>Primary</strong> workspace:</p>
        <CodeBlock code={secretsCmd} />
      </ChecklistStep>
      <ChecklistStep num={4} title="Update secret value and redeploy">
        <p className="mt-1">After updating the secret, redeploy so the new value is picked up:</p>
        <CodeBlock code={`databricks bundle deploy\ndatabricks apps deploy uc-tag-studio`} />
      </ChecklistStep>
      <ChecklistStep num={5} title="Grant Unity Catalog permissions">
        <p className="mt-1">Run in the <strong>{region.display_name}</strong> SQL editor (metastore admin or catalog owner):</p>
        <CodeBlock code={grantsSQL} />
        <p className="mt-2 text-xs text-gray-500">After granting, configure catalogs and schemas via the <strong>Settings</strong> tab.</p>
      </ChecklistStep>
      <ChecklistStep num={6} title="Verify in Health Check">
        <p className="mt-1">Go to the <strong>Health Check</strong> tab and run a check for {region.display_name} to confirm connectivity.</p>
      </ChecklistStep>
    </div>
  );
}

// ─── Unified Region Card ──────────────────────────────────────────────────────

function RegionCard({
  item,
  isActive,
  onRequest,
  onEdit,
  onRemove,
  onSetup,
}: {
  item: RegionItem;
  isActive: boolean;
  onRequest: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  onSetup?: () => void;
}) {
  const host = item.workspace_url.replace(/^https?:\/\//, '');

  return (
    <div
      className={`rounded-xl border transition-all overflow-hidden ${
        isActive
          ? 'border-indigo-300 dark:border-indigo-600 shadow-lg bg-indigo-50 dark:bg-indigo-950/40'
          : 'border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {/* Active accent bar */}
      {isActive && <div className="h-1.5 bg-brand-dark w-full" />}

      {/* Top bar: activation + actions */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${
        isActive
          ? 'bg-indigo-100/60 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700/60'
          : 'border-gray-100 dark:border-gray-700'
      }`}>
        {/* Activation control */}
        {isActive ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-brand-dark text-white shadow-sm">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Active region
          </span>
        ) : (
          <button
            onClick={onRequest}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-brand-dark hover:text-brand-dark dark:hover:border-brand dark:hover:text-brand bg-white dark:bg-gray-700 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full border-2 border-gray-400 dark:border-gray-500" />
            Set as active region
          </button>
        )}

        {/* Action buttons (secondary only) */}
        <div className="flex items-center gap-2">
          {item.is_primary && (
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium px-2">primary</span>
          )}
          {!item.is_primary && onSetup && (
            <button onClick={onSetup}
              title="View setup checklist"
              className={`px-2 py-1 text-xs font-medium rounded-lg border transition-colors ${
                item.secret_configured
                  ? 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                  : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50'
              }`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </button>
          )}
          {!item.is_primary && onEdit && (
            <button onClick={onEdit}
              className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
              Edit
            </button>
          )}
          {!item.is_primary && onRemove && (
            <button onClick={onRemove}
              className="px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base">{item.display_name || 'Primary'}</h3>
          {item.slot !== undefined && (
            <span className="text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
              slot {item.slot}
            </span>
          )}
          {!item.is_primary && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
              item.secret_configured
                ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${item.secret_configured ? 'bg-green-500 dark:bg-green-400' : 'bg-amber-400 dark:bg-amber-400'}`} />
              {item.secret_configured ? 'Secret configured' : 'Awaiting secret'}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mb-2" title={item.workspace_url}>{host}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
          {item.sp_client_id && (
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">SP:</span>{' '}
              <code className="font-mono">{item.sp_client_id}</code>
            </span>
          )}
          {item.sql_warehouse_id && (
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">Warehouse:</span>{' '}
              <code className="font-mono">{item.sql_warehouse_id}</code>
            </span>
          )}
          {item.config_label && (
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">Config:</span>{' '}
              <code className="font-mono">{item.config_label}</code>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Region Form Modal ────────────────────────────────────────────────────────

interface RegionFormData {
  workspace_url: string;
  display_name: string;
  sp_client_id: string;
  sql_warehouse_id: string;
}

function RegionFormModal({
  initial,
  nextSlot,
  MAX_SLOTS,
  onClose,
  onSubmit,
}: {
  initial?: RegionConfig;
  nextSlot: number | null;
  MAX_SLOTS: number;
  onClose: () => void;
  onSubmit: (data: RegionFormData) => void;
}) {
  const isEdit = !!initial;
  const effectiveSlot = initial?.slot ?? nextSlot;

  const [form, setForm] = useState<RegionFormData>({
    workspace_url: initial?.workspace_url ?? '',
    display_name: initial?.display_name ?? '',
    sp_client_id: initial?.sp_client_id ?? '',
    sql_warehouse_id: initial?.sql_warehouse_id ?? '',
  });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.workspace_url.trim()) { setError('Workspace URL is required'); return; }
    if (!form.display_name.trim()) { setError('Display name is required'); return; }
    if (!form.sp_client_id.trim()) { setError('SP Client ID is required'); return; }
    if (!form.sql_warehouse_id.trim()) { setError('SQL Warehouse ID is required'); return; }
    onSubmit(form); // parent closes modal and fires mutation
  };

  const field = (key: keyof RegionFormData, label: string, placeholder: string, hint?: string) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input type="text" value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-brand-dark focus:border-brand-dark outline-none dark:bg-gray-700 dark:text-gray-100 dark:focus:ring-gray-500" />
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">
              {isEdit ? 'Edit Metastore Region' : 'Add Metastore Region'}
            </h2>
            {!isEdit && effectiveSlot && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Secret slot {effectiveSlot} of {MAX_SLOTS}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {field('workspace_url', 'Workspace URL', 'https://adb-xxxx.azuredatabricks.net', 'Full URL of the secondary Databricks workspace')}
          {field('display_name', 'Display Name', 'AWS Ireland', 'Human-readable name shown in the workspace selector')}
          {field('sp_client_id', 'SP Client ID', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'Application (Client) ID of the service principal in the target workspace')}
          {field('sql_warehouse_id', 'SQL Warehouse ID', 'abc123def456', 'ID of the SQL warehouse in the target workspace')}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">{error}</p>
          )}
          {!isEdit && nextSlot === null && (
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
              All {MAX_SLOTS} secret slots are in use. Remove an existing region first.
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!isEdit && nextSlot === null}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-dark rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
              {isEdit ? 'Save Changes' : 'Add Metastore Region'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Regions({
  workspace,
  onWorkspaceChange,
}: {
  workspace: string;
  onWorkspaceChange: (url: string) => void;
}) {
  const qc = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editRegion, setEditRegion] = useState<RegionConfig | null>(null);
  const [drawerRegion, setDrawerRegion] = useState<RegionConfig | null>(null);
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);

  const { data: regionsData, isLoading, isError, error } = useQuery({
    queryKey: ['regions'],
    queryFn: apiClient.getRegions,
  });

  const MAX_SLOTS = 5;
  const usedSlots = new Set((regionsData?.regions ?? []).map((r) => r.slot));
  const nextSlot = !regionsData ? null : ([...Array(MAX_SLOTS)].map((_, i) => i + 1).find((n) => !usedSlots.has(n)) ?? null);
  const { data: workspaces = [] } = useQuery<WorkspaceInfo[]>({
    queryKey: ['workspaces'],
    queryFn: apiClient.getWorkspaces,
  });
  const { data: identity } = useQuery({
    queryKey: ['identity'],
    queryFn: apiClient.getAppIdentity,
  });

  const primaryWs = workspaces.find((w) => w.is_primary);

  // Build unified list: primary first, then secondary
  const allItems: RegionItem[] = [];

  if (primaryWs || identity) {
    const url = primaryWs?.workspace_url ?? '';
    allItems.push({
      id: 'primary',
      workspace_url: url,
      display_name: primaryWs?.display_name || 'Primary',
      sp_client_id: identity?.sp_client_id || identity?.user_name || '',
      sql_warehouse_id: identity?.sql_warehouse_id || '',
      is_primary: true,
      secret_configured: true,
      config_label: identity ? `${identity.config_catalog}.${identity.config_schema}` : undefined,
    });
  }

  for (const r of regionsData?.regions ?? []) {
    allItems.push({
      id: `slot-${r.slot}`,
      workspace_url: r.workspace_url,
      display_name: r.display_name,
      sp_client_id: r.sp_client_id,
      sql_warehouse_id: r.sql_warehouse_id,
      is_primary: false,
      slot: r.slot,
      secret_configured: r.secret_configured,
      secret_scope: r.secret_scope,
      secret_key: r.secret_key,
      source: r,
    });
  }

  const primaryUrl = primaryWs?.workspace_url ?? '';
  const isItemActive = (item: RegionItem) => {
    if (!workspace) return item.is_primary;
    return item.workspace_url === workspace ||
      (item.is_primary && (workspace === 'primary' || workspace === primaryUrl));
  };

  const toast = useToast();

  const addMutation = useMutation({
    mutationFn: (data: RegionFormData) => apiClient.addRegion(data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      toast.success(`Region "${r.display_name}" added`);
      setDrawerRegion(r);
    },
    onError: (err) => toast.error(`Failed to add region: ${extractErrorMessage(err)}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ slot, data }: { slot: number; data: RegionFormData }) =>
      apiClient.updateRegion(slot, data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      toast.success(`Region "${r.display_name}" updated`);
      setDrawerRegion(r);
    },
    onError: (err) => toast.error(`Failed to update region: ${extractErrorMessage(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (slot: number) => apiClient.deleteRegion(slot),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      toast.success('Region removed');
    },
    onError: (err) => toast.error(`Failed to remove region: ${extractErrorMessage(err)}`),
  });

  const handleRemove = (item: RegionItem) => {
    if (!item.source) return;
    if (!confirm(`Remove "${item.display_name}" (slot ${item.slot})?`)) return;
    deleteMutation.mutate(item.source.slot);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Metastore Regions</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select the active region to scope all app views. Configure catalogs and schemas per
            region in the <strong>Settings</strong> tab.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={!regionsData || nextSlot === null}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-dark rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Metastore Region
        </button>
      </div>

      {/* Region list — primary renders immediately, secondary has loading overlay */}
      {isError ? (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {extractErrorMessage(error)}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Primary card — visible as soon as identity/workspaces resolve */}
          {allItems.filter(i => i.is_primary).map((item) => (
            <RegionCard
              key={item.id}
              item={item}
              isActive={isItemActive(item)}
              onRequest={() => setPending({ url: item.workspace_url, name: item.display_name || 'Primary' })}
            />
          ))}

          {/* Secondary cards with loading overlay */}
          <div className="relative">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-2.5 px-5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm text-sm text-gray-500 dark:text-gray-400">
                  <svg className="animate-spin w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading secondary regions…
                </div>
              </div>
            ) : (
              <>
                {allItems.filter(i => !i.is_primary).map((item) => (
                  <RegionCard
                    key={item.id}
                    item={item}
                    isActive={isItemActive(item)}
                    onRequest={() => setPending({ url: item.workspace_url, name: item.display_name || 'Primary' })}
                    onEdit={item.source ? () => setEditRegion(item.source!) : undefined}
                    onRemove={item.source ? () => handleRemove(item) : undefined}
                    onSetup={item.source ? () => setDrawerRegion(item.source!) : undefined}
                  />
                ))}

                {(regionsData?.regions ?? []).length === 0 && (
                  <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl py-10 text-center">
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">No secondary regions yet.</p>
                    <button onClick={() => setShowAddModal(true)}
                      className="px-4 py-2 text-sm font-medium text-brand-dark border border-brand-dark rounded-lg hover:bg-brand-dark hover:text-white transition-colors">
                      Add a region
                    </button>
                  </div>
                )}

                {regionsData && nextSlot === null && regionsData.regions.length === MAX_SLOTS && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    All {MAX_SLOTS} slots in use. Declare additional{' '}
                    <code className="font-mono">SEC_N_SP_CLIENT_SECRET</code> entries in app.yaml to add more.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm region switch */}
      {pending && (
        <ConfirmSwitchModal
          name={pending.name}
          url={pending.url}
          onConfirm={() => { onWorkspaceChange(pending.url); setPending(null); }}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Setup checklist drawer */}
      <RightDrawer
        open={!!drawerRegion}
        onClose={() => setDrawerRegion(null)}
        title={drawerRegion ? `Setup — ${drawerRegion.display_name}` : ''}
        subtitle={drawerRegion ? `Secret slot ${drawerRegion.slot}` : undefined}
      >
        {drawerRegion && <SetupChecklistContent region={drawerRegion} />}
      </RightDrawer>

      {/* Modals */}
      {showAddModal && (
        <RegionFormModal
          nextSlot={nextSlot}
          MAX_SLOTS={MAX_SLOTS}
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => { setShowAddModal(false); addMutation.mutate(data); }}
        />
      )}
      {editRegion && (
        <RegionFormModal
          initial={editRegion}
          nextSlot={nextSlot}
          MAX_SLOTS={MAX_SLOTS}
          onClose={() => setEditRegion(null)}
          onSubmit={(data) => { const slot = editRegion.slot; setEditRegion(null); updateMutation.mutate({ slot, data }); }}
        />
      )}
    </div>
  );
}
