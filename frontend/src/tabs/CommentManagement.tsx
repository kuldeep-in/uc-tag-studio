import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import apiClient, { ColumnInfo, TableInfo } from '../api/client';
import CommentSidePanel, { CommentTarget } from '../components/CommentSidePanel';
import { CatalogTree, Chevron, ColumnIcon, TableIcon } from '../components/CatalogTree';

/* ─── Coverage badge ─────────────────────────────────────────────────────── */

function CoverageBadge({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;
  return (
    <span className="ml-1 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 shrink-0">
      {done}/{total} · {pct}%
    </span>
  );
}

/* ─── Column rows ────────────────────────────────────────────────────────── */

function ColumnRows({
  table,
  onEdit,
}: {
  table: TableInfo;
  onEdit: (t: CommentTarget) => void;
}) {
  const ws = table.workspace_url || 'primary';
  const { data, isLoading } = useQuery<ColumnInfo[]>({
    queryKey: ['columns', ws, table.full_name],
    queryFn: () => apiClient.getColumns(table.full_name, ws),
  });

  if (isLoading)
    return (
      <div className="pl-[76px] py-1.5 text-xs text-gray-400">Loading columns…</div>
    );

  return (
    <div>
      {(data ?? []).map((c) => (
        <div
          key={c.name}
          className={`flex items-center gap-2.5 pl-[76px] pr-4 py-1.5 border-t border-gray-50 ${
            !c.has_comment ? 'bg-amber-50 hover:bg-amber-100' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <ColumnIcon className="text-gray-300" />
          <span className="font-mono text-xs text-gray-700 shrink-0 w-36 truncate">{c.name}</span>
          <span className="text-xs text-gray-400 shrink-0 w-24 truncate">{c.type_text}</span>
          {c.comment ? (
            <span className="text-xs text-gray-500 truncate flex-1">{c.comment}</span>
          ) : (
            <span className="text-xs text-amber-600 flex-1">no description</span>
          )}
          <button
            className="text-xs text-brand hover:underline shrink-0"
            onClick={() =>
              onEdit({
                type: 'column',
                full_name: table.full_name,
                column_name: c.name,
                label: `${table.name}.${c.name}`,
                comment: c.comment,
              })
            }
          >
            Edit
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── Table node (expandable to show columns) ────────────────────────────── */

function TableNode({
  table,
  onEdit,
}: {
  table: TableInfo;
  onEdit: (t: CommentTarget) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div
        className={`flex items-center gap-2.5 pl-[44px] pr-4 py-2 border-t border-gray-50 ${
          !table.has_comment
            ? 'bg-amber-50 hover:bg-amber-100'
            : 'bg-white hover:bg-gray-50'
        }`}
      >
        <button
          className="w-3 flex justify-center shrink-0"
          onClick={() => setOpen((o) => !o)}
          title="Expand columns"
        >
          <Chevron open={open} />
        </button>
        <TableIcon className="text-gray-400 shrink-0" />
        <span className="text-sm font-medium text-gray-800 shrink-0 w-44 truncate">
          {table.name}
        </span>
        {table.comment ? (
          <span className="text-xs text-gray-500 truncate flex-1">{table.comment}</span>
        ) : (
          <span className="text-xs text-amber-600 flex-1">no description</span>
        )}
        <button
          className="text-xs text-brand hover:underline shrink-0"
          onClick={() =>
            onEdit({
              type: 'table',
              full_name: table.full_name,
              label: table.full_name,
              comment: table.comment,
            })
          }
        >
          Edit
        </button>
      </div>
      {open && <ColumnRows table={table} onEdit={onEdit} />}
    </div>
  );
}

/* ─── CommentManagement ──────────────────────────────────────────────────── */

export default function CommentManagement({ workspace }: { workspace: string }) {
  const [panel, setPanel] = useState<CommentTarget | null>(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');

  const scopeQuery = useQuery({ queryKey: ['scope'], queryFn: apiClient.getScope });
  const activeScope = useMemo(
    () => (scopeQuery.data ?? []).filter((s) => s.is_active && s.workspace_url === workspace),
    [scopeQuery.data, workspace]
  );

  const catalogs = useMemo(
    () => Array.from(new Set(activeScope.map((s) => s.catalog_name))).sort(),
    [activeScope]
  );
  const schemas = useMemo(
    () =>
      Array.from(
        new Set(
          activeScope
            .filter((s) => !catalogFilter || s.catalog_name === catalogFilter)
            .map((s) => s.schema_name)
        )
      ).sort(),
    [activeScope, catalogFilter]
  );

  const visibleScope = useMemo(
    () =>
      activeScope.filter(
        (s) =>
          (!catalogFilter || s.catalog_name === catalogFilter) &&
          (!schemaFilter || s.schema_name === schemaFilter)
      ),
    [activeScope, catalogFilter, schemaFilter]
  );

  // Pre-warm table cache so coverage badges appear before schemas are opened.
  useQueries({
    queries: activeScope.map((s) => ({
      queryKey: ['tables', s.workspace_url, s.catalog_name, s.schema_name],
      queryFn: () => apiClient.getTables(s.catalog_name, s.schema_name, s.workspace_url),
      staleTime: 30_000,
    })),
  });

  if (scopeQuery.isLoading) return <div className="text-gray-500">Loading scope…</div>;
  if (activeScope.length === 0)
    return (
      <div className="text-gray-500">
        No active scope. Add catalogs/schemas in the Configuration tab.
      </div>
    );

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Catalog</label>
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={catalogFilter}
            onChange={(e) => { setCatalogFilter(e.target.value); setSchemaFilter(''); }}
          >
            <option value="">All</option>
            {catalogs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Schema</label>
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={schemaFilter}
            onChange={(e) => setSchemaFilter(e.target.value)}
          >
            <option value="">All</option>
            {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 ml-auto">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 border border-amber-200" />
            missing description
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-white border border-gray-200" />
            described
          </span>
        </div>
      </div>

      {/* Tree */}
      <CatalogTree
        scope={visibleScope}
        workspace={workspace}
        renderTable={(table) => <TableNode table={table} onEdit={setPanel} />}
        schemaHeaderRight={(tables, isLoading) => {
          if (isLoading || !tables) return null;
          const commented = tables.filter((t) => t.has_comment).length;
          return <CoverageBadge done={commented} total={tables.length} />;
        }}
        emptyMessage="No schemas match the selected filters."
      />

      {panel && <CommentSidePanel target={panel} onClose={() => setPanel(null)} />}
    </div>
  );
}
