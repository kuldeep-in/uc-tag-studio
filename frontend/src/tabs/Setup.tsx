import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { CachedCheckRow, SetupCheck, PermissionEntry, WorkspaceInfo, PermissionsTree, PermCatalogNode, PermSchemaNode } from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetupMeta {
  sp_client_id: string;
  config_catalog: string;
  config_schema: string;
  sql_warehouse_id: string;
}

interface NoteEntry {
  id: string;
  message: string;
  fix_sql: string | null;
  fix_where: string | null;
  check_group_id: string;
}

interface CheckGroup {
  id: string;
  label: string;
  workspace_url: string | null;
  notes: NoteEntry[];
  checks: SetupCheck[];
  permissions: PermissionEntry[];
  checked_at: string | null;
  loading: boolean;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconOk() {
  return (
    <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconError() {
  return (
    <svg className="w-4 h-4 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconWarn() {
  return (
    <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 text-gray-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconRefresh({ spinning }: { spinning?: boolean }) {
  return (
    <svg className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 transition-colors"
    >
      {copied ? (
        <><svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Copied</>
      ) : (
        <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" /><path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>Copy</>
      )}
    </button>
  );
}

// ─── NoteBox ──────────────────────────────────────────────────────────────────

function NoteBox({ note }: { note: NoteEntry }) {
  const [fixOpen, setFixOpen] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50">
        <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-amber-800">Recommended setup</div>
          <div className="text-xs text-amber-700 mt-0.5">{note.message}</div>
        </div>
        {note.fix_sql && (
          <button
            onClick={() => setFixOpen((o) => !o)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-amber-300 bg-white hover:bg-amber-50 text-amber-700 transition-colors"
          >
            SQL <IconChevron open={fixOpen} />
          </button>
        )}
      </div>
      {note.fix_sql && fixOpen && (
        <div className="border-t border-amber-200 bg-white px-4 py-3 space-y-2">
          {note.fix_where && (
            <div className="text-xs text-gray-500">
              Run in: <span className="font-medium text-gray-700">{note.fix_where}</span>
            </div>
          )}
          <div className="flex justify-end"><CopyButton text={note.fix_sql} /></div>
          <pre className="text-xs text-gray-700 font-mono bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto whitespace-pre leading-relaxed">{note.fix_sql}</pre>
        </div>
      )}
    </div>
  );
}

function stepColors(status: 'ok' | 'error' | 'warning') {
  if (status === 'ok')      return { border: 'border-green-100',  bg: 'bg-green-50',  badge: 'bg-green-200 text-green-800',  msg: 'text-green-700',  btn: 'border-green-200 hover:bg-green-50 text-green-700',  fix: 'border-green-100' };
  if (status === 'warning') return { border: 'border-yellow-200', bg: 'bg-yellow-50', badge: 'bg-yellow-200 text-yellow-800', msg: 'text-yellow-700', btn: 'border-yellow-300 hover:bg-yellow-50 text-yellow-700', fix: 'border-yellow-200' };
  return                           { border: 'border-red-200',    bg: 'bg-red-50',    badge: 'bg-red-200 text-red-800',       msg: 'text-red-700',    btn: 'border-red-200 hover:bg-red-50 text-red-700',         fix: 'border-red-200' };
}

// ─── StepRow ──────────────────────────────────────────────────────────────────

function StepRow({ check }: { check: SetupCheck }) {
  const [fixOpen, setFixOpen] = useState(false);
  const hasFix = !!check.fix_sql;
  const c = stepColors(check.status);
  return (
    <div className={`rounded-lg border overflow-hidden ${c.border}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${c.bg}`}>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${c.badge}`}>{check.step}</div>
        {check.status === 'ok' ? <IconOk /> : check.status === 'warning' ? <IconWarn /> : <IconError />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800">{check.label}</div>
          <div className={`text-xs mt-0.5 ${c.msg}`}>{check.message}</div>
        </div>
        {hasFix && (
          <button onClick={() => setFixOpen((o) => !o)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border bg-white transition-colors ${c.btn}`}>
            {check.status === 'ok' ? 'SQL' : 'Fix'} <IconChevron open={fixOpen} />
          </button>
        )}
      </div>
      {hasFix && fixOpen && (
        <div className={`border-t ${c.fix} bg-white px-4 py-3 space-y-2`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">Run in: <span className="font-medium text-gray-700">{check.fix_where}</span></div>
            <CopyButton text={check.fix_sql!} />
          </div>
          <pre className="text-xs text-gray-700 font-mono bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto whitespace-pre leading-relaxed">{check.fix_sql}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Permissions tree ─────────────────────────────────────────────────────────

function PrivChip({ label }: { label: string }) {
  const display = label.replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
      {display}
    </span>
  );
}

function PrivList({ privileges }: { privileges: string[] }) {
  if (!privileges.length) return <span className="text-xs text-gray-400 italic">none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {privileges.map((p) => <PrivChip key={p} label={p} />)}
    </div>
  );
}

function TreeNode({
  icon, label, sublabel, badge, defaultOpen = true, indent = 0, children,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  indent?: number;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ paddingLeft: indent * 20 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 py-2 px-3 hover:bg-gray-50 rounded text-left group"
      >
        <IconChevron open={open} />
        {icon}
        <span className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">{label}</span>
        {sublabel && <span className="text-xs text-gray-400 shrink-0">{sublabel}</span>}
        {badge}
      </button>
      {open && children && <div className="ml-6">{children}</div>}
    </div>
  );
}

function TableRow({ name, privileges }: { name: string; privileges: string[] }) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-3 hover:bg-gray-50 rounded">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-300">
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" strokeWidth="1.4" />
        <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" strokeWidth="1.2" />
        <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" strokeWidth="1.2" />
        <line x1="6" y1="5.5" x2="6" y2="14.5" strokeWidth="1.2" />
      </svg>
      <span className="text-xs font-mono text-gray-600 flex-1 min-w-0 truncate">{name}</span>
      <PrivList privileges={privileges} />
    </div>
  );
}

function WarehouseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-500">
      <path d="M1 6l7-4 7 4v7a1 1 0 01-1 1H2a1 1 0 01-1-1V6z" strokeWidth="1.4" />
      <rect x="5" y="9" width="6" height="4" strokeWidth="1.2" />
    </svg>
  );
}

function CatalogIcon2() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-500">
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" strokeWidth="1.5" />
      <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" strokeWidth="1.2" />
      <line x1="4.5" y1="8" x2="11.5" y2="8" strokeWidth="1.2" />
      <line x1="4.5" y1="10.5" x2="8.5" y2="10.5" strokeWidth="1.2" />
    </svg>
  );
}

function AllSchemasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
      <ellipse cx="8" cy="4" rx="5.5" ry="2" strokeWidth="1.4" />
      <path d="M2.5 4v8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" strokeWidth="1.4" />
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" strokeWidth="1.4" />
    </svg>
  );
}

function RoleBadge({ label, color }: { label: string; color: string }) {
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>{label}</span>;
}

function PermissionsTreeView({ tree }: { tree: PermissionsTree }) {
  return (
    <div className="space-y-1">
      {/* SQL Warehouse */}
      {tree.warehouse && (
        <TreeNode
          icon={<WarehouseIcon />}
          label="SQL Warehouse"
          sublabel={tree.warehouse.id}
        >
          <div className="py-1.5 px-3">
            <PrivList privileges={tree.warehouse.privileges} />
          </div>
        </TreeNode>
      )}

      {/* Catalogs */}
      {tree.catalogs.map((cat: PermCatalogNode) => (
        <TreeNode
          key={cat.name}
          icon={<CatalogIcon2 />}
          label={cat.name}
          badge={
            <div className="flex gap-1 shrink-0">
              {cat.roles.includes('managed') && <RoleBadge label="managed" color="bg-violet-50 text-violet-700" />}
              {cat.roles.includes('config') && <RoleBadge label="config" color="bg-amber-50 text-amber-700" />}
            </div>
          }
        >
          {/* Catalog-level grants — show as "All schemas" row */}
          {cat.privileges.length > 0 && (
            <TreeNode icon={<AllSchemasIcon />} label="All schemas" sublabel="catalog-level · cascades" indent={0}>
              <div className="py-1.5 px-3">
                <PrivList privileges={cat.privileges} />
              </div>
            </TreeNode>
          )}

          {/* Specific schemas */}
          {cat.schemas.map((sch: PermSchemaNode) => (
            <TreeNode
              key={sch.name}
              icon={<AllSchemasIcon />}
              label={sch.name}
              badge={<RoleBadge label={sch.role} color="bg-amber-50 text-amber-700" />}
              indent={0}
            >
              {/* Schema-level grants if any beyond catalog */}
              {sch.privileges.length > 0 && (
                <div className="py-1.5 px-3">
                  <PrivList privileges={sch.privileges} />
                </div>
              )}
              {/* Tables */}
              {sch.tables.map((tbl) => (
                <TableRow key={tbl.name} name={tbl.name} privileges={tbl.privileges} />
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      ))}
    </div>
  );
}

// ─── Group status summary ─────────────────────────────────────────────────────

function GroupStatusBadges({ checks, loading }: {
  checks: SetupCheck[];
  loading: boolean;
}) {
  if (loading) return <span className="text-xs text-gray-400 flex items-center gap-1"><IconSpinner />Checking…</span>;
  if (!checks.length) return <span className="text-xs text-gray-400">No results</span>;

  const errors = checks.filter((c) => c.status === 'error').length;
  const warns = checks.filter((c) => c.status === 'warning').length;
  const oks = checks.filter((c) => c.status === 'ok').length;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {errors > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium"><IconError />{errors} error{errors > 1 ? 's' : ''}</span>}
      {warns > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium"><IconWarn />{warns} warning{warns > 1 ? 's' : ''}</span>}
      {oks > 0 && errors === 0 && warns === 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium"><IconOk />All ok</span>}
      {oks > 0 && (errors > 0 || warns > 0) && <span className="text-gray-400">{oks} ok</span>}
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  checks = [],
  notes = [],
  loading,
  checkedAt,
  onRecheck,
}: {
  title: string;
  checks?: SetupCheck[];
  notes?: NoteEntry[];
  loading: boolean;
  checkedAt: string | null;
  onRecheck: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isEmpty = !loading && checks.length === 0 && notes.length === 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <IconChevron open={open} />
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </button>
        <GroupStatusBadges checks={checks} loading={loading} />
        {checkedAt && !loading && (
          <span className="text-xs text-gray-400 shrink-0">{timeAgo(checkedAt)}</span>
        )}
        <button
          onClick={onRecheck}
          disabled={loading}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
        >
          <IconRefresh spinning={loading} />
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {open && (
        <div className="px-4 py-4 space-y-4">
          {checks.length > 0 && (
            <div className="space-y-2">
              {checks.map((check, idx) => <StepRow key={check.id} check={{ ...check, step: idx + 1 }} />)}
              {loading && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
                  <IconSpinner />Running next check…
                </div>
              )}
            </div>
          )}
          {loading && checks.length === 0 && notes.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
              <IconSpinner />Running checks…
            </div>
          )}
          {loading && checks.length === 0 && notes.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
              <IconSpinner />Checking…
            </div>
          )}
          {notes.length > 0 && (
            <div className="space-y-2">
              {notes.map((note) => <NoteBox key={note.id} note={note} />)}
            </div>
          )}
          {isEmpty && (
            <div className="text-sm text-gray-400 text-center py-4">No results — click Re-check</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Build groups from flat cached rows ───────────────────────────────────────

function rowsToGroups(rows: CachedCheckRow[]): CheckGroup[] {
  const groupMap = new Map<string, CheckGroup>();
  const groupOrder: string[] = [];

  for (const row of rows) {
    if (!groupMap.has(row.check_group_id)) {
      groupMap.set(row.check_group_id, {
        id: row.check_group_id,
        label: row.check_group_label,
        workspace_url: row.workspace_url,
        notes: [],
        checks: [],
        permissions: [],
        checked_at: row.checked_at,
        loading: false,
      });
      groupOrder.push(row.check_group_id);
    }
    const g = groupMap.get(row.check_group_id)!;
    if (row.checked_at && (!g.checked_at || row.checked_at > g.checked_at)) {
      g.checked_at = row.checked_at;
    }

    if (row.check_type === 'check' && row.label != null) {
      g.checks.push({
        id: row.check_id,
        step: row.step ?? 0,
        label: row.label,
        status: row.status,
        message: row.message ?? '',
        fix_sql: row.fix_sql,
        fix_where: row.fix_where,
        check_group_id: row.check_group_id,
        check_group_label: row.check_group_label,
      });
    } else if (row.check_type === 'permission') {
      g.permissions.push({
        id: row.check_id,
        group: row.perm_group ?? '',
        resource: row.resource ?? '',
        privilege: row.privilege ?? '',
        status: row.status,
        message: row.message ?? '',
        fix_sql: row.fix_sql,
        fix_where: row.fix_where,
        check_group_id: row.check_group_id,
        check_group_label: row.check_group_label,
      });
    }
  }

  return groupOrder.map((id) => groupMap.get(id)!);
}

// ─── SSE streaming into a single group ────────────────────────────────────────

function streamGroup(
  groupIds: string[],
  onMeta: (m: { sp_client_id: string; config_catalog: string; config_schema: string; sql_warehouse_id: string }) => void,
  onGroupStart: (groupId: string, groupLabel: string) => void,
  onCheck: (check: SetupCheck) => void,
  onPermission: (perm: PermissionEntry) => void,
  onNote: (note: NoteEntry) => void,
  onGroupDone: (groupId: string) => void,
  onAllDone: () => void,
  signal: AbortSignal,
): void {
  const url = `/api/config/setup-status/stream?groups=${encodeURIComponent(groupIds.join(','))}`;

  fetch(url, { signal })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const seenGroups = new Set<string>();

      function pump(): Promise<void> {
        return reader.read().then(({ done, value }) => {
          if (done) { onAllDone(); return; }
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop()!;
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.type === 'meta') {
                onMeta(msg.data);
              } else if (msg.type === 'note') {
                const d = msg.data;
                if (!seenGroups.has(d.check_group_id)) {
                  seenGroups.add(d.check_group_id);
                  onGroupStart(d.check_group_id, d.check_group_label);
                }
                onNote(d as NoteEntry);
              } else if (msg.type === 'check') {
                const d = msg.data;
                if (!seenGroups.has(d.check_group_id)) {
                  seenGroups.add(d.check_group_id);
                  onGroupStart(d.check_group_id, d.check_group_label);
                }
                onCheck(d);
              } else if (msg.type === 'permission') {
                const d = msg.data;
                if (!seenGroups.has(d.check_group_id)) {
                  seenGroups.add(d.check_group_id);
                  onGroupStart(d.check_group_id, d.check_group_label);
                }
                onPermission(d);
              } else if (msg.type === 'done') {
                seenGroups.forEach((id) => onGroupDone(id));
                onAllDone();
              }
            } catch { /* ignore */ }
          }
          return pump();
        });
      }
      return pump();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onAllDone();
    });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Setup({ workspace, workspaces }: { workspace: string; workspaces: WorkspaceInfo[] }) {
  const [groups, setGroups] = useState<CheckGroup[]>([]);
  const [meta, setMeta] = useState<SetupMeta | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Derive backend group ID for the selected workspace:
  // primary workspace → "primary", secondary n → "secondary_n"
  const wsGroupId = useMemo(() => {
    const idx = workspaces.findIndex((w) => w.workspace_url === workspace);
    return idx <= 0 ? 'primary' : `secondary_${idx}`;
  }, [workspace, workspaces]);

  // Keep a ref so runRecheck always sees the latest wsGroupId without re-creating
  const wsGroupIdRef = useRef(wsGroupId);
  useEffect(() => { wsGroupIdRef.current = wsGroupId; }, [wsGroupId]);

  // Reload cached results whenever the selected workspace changes
  useEffect(() => {
    abortRefs.current.forEach((c) => c.abort());
    abortRefs.current.clear();
    setGroups([]);
    setInitialLoading(true);

    apiClient.getCachedSetupStatus()
      .then((rows) => {
        const relevant = rows.filter(
          (r) => r.check_group_id === 'app' || r.check_group_id === wsGroupId,
        );
        setGroups(rowsToGroups(relevant));
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [wsGroupId]);

  const runRecheck = useCallback((groupId: string | null) => {
    // null = Re-check All = app + current workspace group
    const groupsToRun = groupId === null
      ? ['app', wsGroupIdRef.current]
      : [groupId];
    const key = groupId ?? '__all__';

    abortRefs.current.get(key)?.abort();
    const controller = new AbortController();
    abortRefs.current.set(key, controller);

    setGroups((prev) => {
      const targets = new Set(groupsToRun);
      return prev.map((g) =>
        targets.has(g.id) ? { ...g, notes: [], checks: [], permissions: [], loading: true } : g
      );
    });

    streamGroup(
      groupsToRun,
      (m) => setMeta(m),
      (gid, glabel) => {
        setGroups((prev) => {
          const exists = prev.some((g) => g.id === gid);
          if (exists) return prev;
          return [...prev, { id: gid, label: glabel, workspace_url: null, notes: [], checks: [], permissions: [], checked_at: null, loading: true }];
        });
      },
      (check) => setGroups((prev) =>
        prev.map((g) => g.id === check.check_group_id
          ? { ...g, checks: [...g.checks, check] }
          : g
        )
      ),
      (perm) => setGroups((prev) =>
        prev.map((g) => g.id === perm.check_group_id
          ? { ...g, permissions: [...g.permissions, perm] }
          : g
        )
      ),
      (note) => setGroups((prev) =>
        prev.map((g) => g.id === note.check_group_id
          ? { ...g, notes: [...g.notes, note] }
          : g
        )
      ),
      (gid) => setGroups((prev) =>
        prev.map((g) => g.id === gid ? { ...g, loading: false, checked_at: new Date().toISOString() } : g)
      ),
      () => {
        setGroups((prev) => prev.map((g) => ({ ...g, loading: false })));
        abortRefs.current.delete(key);
      },
      controller.signal,
    );
  }, []);

  const appGroup = groups.find((g) => g.id === 'app');
  const wsGroup = groups.find((g) => g.id === wsGroupId);

  const anyLoading = (appGroup?.loading ?? false) || (wsGroup?.loading ?? false);
  const allChecks = [...(appGroup?.checks ?? []), ...(wsGroup?.checks ?? [])];
  const allOk = !initialLoading && !anyLoading
    && allChecks.length > 0
    && allChecks.every((c) => c.status === 'ok');
  const totalErrors = allChecks.filter((c) => c.status === 'error').length;
  const totalWarns = allChecks.filter((c) => c.status === 'warning').length;

  const { data: permTree, isLoading: permTreeLoading, refetch: refetchPermTree } = useQuery<PermissionsTree>({
    queryKey: ['permissions-tree'],
    queryFn: () => apiClient.getPermissionsTree(),
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-gray-500 mt-0.5">
          Checks that all required configuration, tables, and permissions are in place.
          Results are cached — click <span className="font-medium">Re-check</span> on any group to refresh it.
        </p>
        <button
          onClick={() => runRecheck(null)}
          disabled={anyLoading}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
        >
          <IconRefresh spinning={anyLoading} />
          {anyLoading ? 'Checking…' : 'Re-check All'}
        </button>
      </div>

      {/* Meta strip */}
      {meta?.sp_client_id && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-gray-400 mb-0.5">App SP Client ID</div>
            <div className="font-mono text-gray-700 select-all">{meta.sp_client_id}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Config location</div>
            <div className="font-mono text-gray-700">
              {meta.config_catalog || <span className="text-red-400">not set</span>}.{meta.config_schema || <span className="text-red-400">not set</span>}
            </div>
          </div>
        </div>
      )}

      {/* Summary banner */}
      {!anyLoading && groups.length > 0 && (
        allOk ? (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <IconOk />
            <div className="text-sm font-medium text-green-800">All checks passed — the app is fully configured.</div>
          </div>
        ) : totalErrors > 0 ? (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <IconError />
            <div className="text-sm font-medium text-red-800">
              {totalErrors} error{totalErrors > 1 ? 's' : ''}{totalWarns > 0 ? `, ${totalWarns} warning${totalWarns > 1 ? 's' : ''}` : ''} — expand Fix on each failing step.
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            <IconWarn />
            <div className="text-sm font-medium text-yellow-800">
              {totalWarns} warning{totalWarns > 1 ? 's' : ''} — app works but some permissions may limit visibility.
            </div>
          </div>
        )
      )}

      {/* Initial loading (first load, no cache) */}
      {initialLoading && (
        <div className="flex items-center gap-3 text-sm text-gray-500 py-8 justify-center">
          <IconSpinner />Loading cached results…
        </div>
      )}

      {/* 3-section layout (always shown once initial load is done) */}
      {!initialLoading && (
        <>
          <SectionCard
            title="App Checks"
            checks={appGroup?.checks ?? []}
            loading={appGroup?.loading ?? false}
            checkedAt={appGroup?.checked_at ?? null}
            onRecheck={() => runRecheck('app')}
          />
          <SectionCard
            title={workspace}
            checks={wsGroup?.checks ?? []}
            loading={wsGroup?.loading ?? false}
            checkedAt={wsGroup?.checked_at ?? null}
            onRecheck={() => runRecheck(wsGroupId)}
          />
          {/* Permissions tree — always live, no validation */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <span className="text-sm font-semibold text-gray-800 flex-1">Effective Permissions</span>
              <span className="text-xs text-gray-400">App SP · current grants</span>
              <button
                onClick={() => refetchPermTree()}
                disabled={permTreeLoading}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
              >
                <IconRefresh spinning={permTreeLoading} />
                {permTreeLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="px-2 py-3">
              {permTreeLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                  <IconSpinner />Loading permissions…
                </div>
              )}
              {!permTreeLoading && permTree && <PermissionsTreeView tree={permTree} />}
              {!permTreeLoading && !permTree && (
                <div className="text-sm text-gray-400 text-center py-4">Could not load permissions</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
