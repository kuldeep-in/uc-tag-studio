import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import apiClient, { TableInfo, TagDictEntry } from '../api/client';
import TagEditModal from '../components/TagEditModal';
import { CatalogTree, TableIcon } from '../components/CatalogTree';

export default function TagManagement({ workspace }: { workspace: string }) {
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [untaggedOnly, setUntaggedOnly] = useState(false);

  const tagDictQuery = useQuery<TagDictEntry[]>({
    queryKey: ['tagdictionary'],
    queryFn: apiClient.getTagDictionary,
  });

  const scopeQuery = useQuery({
    queryKey: ['scope'],
    queryFn: apiClient.getScope,
  });

  const activeScope = useMemo(
    () => (scopeQuery.data ?? []).filter((s) => s.is_active && s.workspace_url === workspace),
    [scopeQuery.data, workspace]
  );

  // Pre-warm the React Query cache — schema nodes will show data instantly on open.
  useQueries({
    queries: activeScope.map((s) => ({
      queryKey: ['tables', s.workspace_url, s.catalog_name, s.schema_name],
      queryFn: () => apiClient.getTables(s.catalog_name, s.schema_name, s.workspace_url),
      staleTime: 30_000,
    })),
  });

  const tagKeys = (tagDictQuery.data ?? []).map((t) => t.tag_key);

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

  const filterTable = useMemo(
    () =>
      nameFilter || untaggedOnly
        ? (t: TableInfo) => {
            if (nameFilter && !t.name.toLowerCase().includes(nameFilter.toLowerCase()))
              return false;
            if (untaggedOnly && t.tag_count > 0) return false;
            return true;
          }
        : undefined,
    [nameFilter, untaggedOnly]
  );

  if (scopeQuery.isLoading) return <div className="text-gray-500">Loading scope…</div>;
  if (activeScope.length === 0)
    return (
      <div className="text-gray-500">
        No active scope. Add catalogs/schemas in the Configuration tab.
      </div>
    );

  return (
    <div className="space-y-4">
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
        <div>
          <label className="block text-xs text-gray-500 mb-1">Table name</label>
          <input
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="filter…"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={untaggedOnly}
            onChange={(e) => setUntaggedOnly(e.target.checked)}
          />
          Untagged only
        </label>
      </div>

      {/* Tree */}
      <CatalogTree
        scope={visibleScope}
        workspace={workspace}
        filterTable={filterTable}
        renderTable={(table) => {
          const extraTags = Object.keys(table.tags).filter((k) => !tagKeys.includes(k));
          return (
            <div className="flex items-center gap-2.5 pl-[52px] pr-4 py-2 border-t border-gray-50 hover:bg-gray-50">
              <TableIcon className="text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-800 shrink-0 w-40 truncate">
                {table.name}
              </span>

              {/* Tag grid — flex-1 ensures every row in the same schema has the
                  same total width, so repeat(N, 1fr) locks columns into alignment. */}
              {tagKeys.length > 0 ? (
                <div
                  className="flex-1 min-w-0 grid gap-1.5"
                  style={{ gridTemplateColumns: `repeat(${tagKeys.length}, 1fr)` }}
                >
                  {tagKeys.map((k) => (
                    <span
                      key={k}
                      className="flex items-stretch rounded overflow-hidden text-xs border border-gray-200 w-full"
                    >
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 font-medium border-r border-gray-200 whitespace-nowrap shrink-0">
                        {k}
                      </span>
                      {table.tags[k] ? (
                        <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 truncate flex-1 min-w-0">
                          {table.tags[k]}
                        </span>
                      ) : (
                        <span className="bg-white text-gray-300 px-1.5 py-0.5 italic flex-1">
                          —
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-gray-400 flex-1">No tag keys defined</span>
              )}

              {/* Fixed-width slot keeps Edit button aligned across all rows */}
              <span className="shrink-0 w-7 flex justify-center">
                {extraTags.length > 0 && (
                  <span
                    title={extraTags.map((k) => `${k}: ${table.tags[k]}`).join('\n')}
                    className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-1 cursor-help"
                  >
                    +{extraTags.length}
                  </span>
                )}
              </span>

              <button
                onClick={() => setEditing(table)}
                className="text-xs text-brand hover:underline shrink-0"
              >
                Edit
              </button>
            </div>
          );
        }}
        emptyMessage="No schemas match the selected filters."
      />

      {editing && (
        <TagEditModal
          table={editing}
          tagDict={tagDictQuery.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
