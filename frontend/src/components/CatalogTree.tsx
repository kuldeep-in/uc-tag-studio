/**
 * Shared catalog → schema → table tree layout.
 * Both TagManagement and CommentManagement use this component.
 * Table-level content is injected via the `renderTable` prop.
 */

import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { ScopeEntry, TableInfo } from '../api/client';

/* ─── Icons ─────────────────────────────────────────────────────────────── */

export function CatalogIcon({ className = 'text-gray-500' }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" strokeWidth="1.5" />
      <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" strokeWidth="1.2" />
      <line x1="4.5" y1="8" x2="11.5" y2="8" strokeWidth="1.2" />
      <line x1="4.5" y1="10.5" x2="8.5" y2="10.5" strokeWidth="1.2" />
    </svg>
  );
}

export function SchemaIcon({ className = 'text-gray-500' }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" strokeWidth="1.4" />
      <path d="M2.5 4v8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" strokeWidth="1.4" />
      <path d="M2.5 8c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2" strokeWidth="1.4" />
    </svg>
  );
}

export function TableIcon({ className = 'text-gray-400' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" strokeWidth="1.4" />
      <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" strokeWidth="1.2" />
      <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" strokeWidth="1.2" />
      <line x1="6" y1="5.5" x2="6" y2="14.5" strokeWidth="1.2" />
    </svg>
  );
}

export function ColumnIcon({ className = 'text-gray-300' }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}>
      <rect x="1" y="1" width="12" height="12" rx="1.5" strokeWidth="1.4" />
      <line x1="1" y1="5" x2="13" y2="5" strokeWidth="1" />
      <line x1="4.5" y1="1" x2="4.5" y2="13" strokeWidth="1" />
    </svg>
  );
}

export function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 text-gray-400 ${open ? 'rotate-90' : ''} ${className}`}>
      <path d="M3 2L6.5 5 3 8" strokeWidth="1.7" />
    </svg>
  );
}

/* ─── SchemaNode ─────────────────────────────────────────────────────────── */

function SchemaNode({
  catalog,
  schema,
  workspace,
  renderTable,
  schemaHeaderRight,
  filterTable,
}: {
  catalog: string;
  schema: string;
  workspace: string;
  renderTable: (table: TableInfo) => ReactNode;
  schemaHeaderRight?: (tables: TableInfo[] | undefined, isLoading: boolean) => ReactNode;
  filterTable?: (table: TableInfo) => boolean;
}) {
  const [open, setOpen] = useState(false);

  const { data: tables, isLoading, error } = useQuery<TableInfo[]>({
    queryKey: ['tables', workspace, catalog, schema],
    queryFn: () => apiClient.getTables(catalog, schema, workspace),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  });

  const visibleTables = useMemo(
    () => (tables ?? []).filter((t) => !filterTable || filterTable(t)),
    [tables, filterTable]
  );

  return (
    <div>
      {/* Schema row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 pl-7 pr-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 first:border-t-0 text-left"
      >
        <span className="w-3 flex justify-center">
          <Chevron open={open} />
        </span>
        <SchemaIcon />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 min-w-0 truncate">{schema}</span>
        {schemaHeaderRight?.(tables, isLoading)}
      </button>

      {/* Tables */}
      {open && (
        <div>
          {isLoading && (
            <div className="pl-[60px] py-2 text-xs text-gray-400 dark:text-gray-500">Loading tables…</div>
          )}
          {!isLoading && error && (
            <div className="pl-[60px] py-2 text-xs text-red-500 dark:text-red-400">
              Failed to load tables — {(error as Error).message ?? 'unknown error'}
            </div>
          )}
          {!isLoading && !error && visibleTables.length === 0 && (
            <div className="pl-[60px] py-2 text-xs text-gray-400 dark:text-gray-500">
              {tables && tables.length > 0 ? 'No tables match filters.' : 'No tables.'}
            </div>
          )}
          {visibleTables.map((t) => (
            <div key={t.full_name}>{renderTable(t)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── CatalogNode ────────────────────────────────────────────────────────── */

function CatalogNode({ catalog, children }: { catalog: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 pl-3 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
      >
        <span className="w-3 flex justify-center">
          <Chevron open={open} />
        </span>
        <CatalogIcon />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{catalog}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

/* ─── CatalogTree (main export) ──────────────────────────────────────────── */

export interface CatalogTreeProps {
  scope: ScopeEntry[];
  workspace: string;
  renderTable: (table: TableInfo) => ReactNode;
  schemaHeaderRight?: (tables: TableInfo[] | undefined, isLoading: boolean) => ReactNode;
  filterTable?: (table: TableInfo) => boolean;
  emptyMessage?: string;
}

export function CatalogTree({
  scope,
  workspace,
  renderTable,
  schemaHeaderRight,
  filterTable,
  emptyMessage = 'No schemas in scope.',
}: CatalogTreeProps) {
  const byCatalog = useMemo(() => {
    const map = new Map<string, ScopeEntry[]>();
    for (const s of scope) {
      if (!map.has(s.catalog_name)) map.set(s.catalog_name, []);
      map.get(s.catalog_name)!.push(s);
    }
    return map;
  }, [scope]);

  if (scope.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {[...byCatalog.entries()].map(([catalog, entries]) => (
        <CatalogNode key={catalog} catalog={catalog}>
          {entries.map((entry) => (
            <SchemaNode
              key={`${entry.workspace_url}.${entry.catalog_name}.${entry.schema_name}`}
              catalog={entry.catalog_name}
              schema={entry.schema_name}
              workspace={entry.workspace_url || workspace}
              renderTable={renderTable}
              schemaHeaderRight={schemaHeaderRight}
              filterTable={filterTable}
            />
          ))}
        </CatalogNode>
      ))}
    </div>
  );
}
