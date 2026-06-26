import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient, { AppIdentity, ScopeEntry, TagDictEntry, WorkspaceInfo } from '../api/client';
import { useToast } from '../components/Toast';
import Instructions from './Instructions';

function IdentityBanner() {
  const { data, isLoading, error } = useQuery<AppIdentity>({
    queryKey: ['app-identity'],
    queryFn: apiClient.getAppIdentity,
  });

  if (isLoading) return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-4 text-sm text-gray-400 animate-pulse">
      Loading app identity…
    </div>
  );
  if (error || !data) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 space-y-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        App Identity — Primary Workspace
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-xs text-gray-400 mb-1">Running as</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
              data.is_service_principal
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {data.is_service_principal ? 'Service Principal' : 'User'}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Identity</div>
          <div className="font-mono text-xs text-gray-700 truncate" title={data.user_name}>
            {data.display_name !== data.user_name
              ? <><span className="font-medium">{data.display_name}</span><span className="text-gray-400 ml-1">({data.user_name})</span></>
              : data.user_name}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">SQL Warehouse</div>
          <div className="font-mono text-xs text-gray-700">{data.sql_warehouse_id || <span className="text-red-400">not set</span>}</div>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Config Table Location
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-400 mb-1">Catalog</div>
            <div className="font-mono text-xs text-gray-700">
              {data.config_catalog || <span className="text-red-400">not set — add CONFIG_CATALOG to app.yaml</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Schema</div>
            <div className="font-mono text-xs text-gray-700">
              {data.config_schema || <span className="text-red-400">not set — add CONFIG_SCHEMA to app.yaml</span>}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Config tables (<code className="bg-gray-100 px-1 rounded">govern_tag_dictionary</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">govern_scope_config</code>) are stored at{' '}
          <span className="font-mono">{data.config_catalog || '?'}.{data.config_schema || '?'}</span>.
          The app SP must have SELECT + MODIFY on both tables.
        </p>
      </div>
    </div>
  );
}

function ScopeTable({
  entries,
  onToggle,
  onRemove,
}: {
  entries: ScopeEntry[];
  onToggle: (s: ScopeEntry, active: boolean) => void;
  onRemove: (s: ScopeEntry) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-gray-500 text-left">
        <tr>
          <th className="px-4 py-2">Catalog</th>
          <th className="px-4 py-2">Schema</th>
          <th className="px-4 py-2">Active</th>
          <th className="px-4 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((s) => (
          <tr key={`${s.workspace_url}.${s.catalog_name}.${s.schema_name}`} className="border-t border-gray-100">
            <td className="px-4 py-2">{s.catalog_name}</td>
            <td className="px-4 py-2">{s.schema_name}</td>
            <td className="px-4 py-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.is_active}
                  onChange={(e) => onToggle(s, e.target.checked)}
                />
                <span className="text-xs text-gray-500">{s.is_active ? 'active' : 'inactive'}</span>
              </label>
            </td>
            <td className="px-4 py-2 text-right">
              <button
                onClick={() => onRemove(s)}
                className="text-red-600 hover:underline text-sm"
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
        {entries.length === 0 && (
          <tr>
            <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
              No entries yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function ScopeSection({ wsInfo }: { wsInfo: WorkspaceInfo }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selCatalog, setSelCatalog] = useState('');
  const [selSchema, setSelSchema] = useState('');

  const scopeQuery = useQuery<ScopeEntry[]>({
    queryKey: ['scope'],
    queryFn: apiClient.getScope,
  });
  const entries = useMemo(
    () => (scopeQuery.data ?? []).filter((s) => s.workspace_url === wsInfo.workspace_url),
    [scopeQuery.data, wsInfo.workspace_url]
  );

  const catalogsQuery = useQuery({
    queryKey: ['catalogs', wsInfo.workspace_url],
    queryFn: () => apiClient.getCatalogs(wsInfo.workspace_url),
  });
  const schemasQuery = useQuery({
    queryKey: ['schemas', wsInfo.workspace_url, selCatalog],
    queryFn: () => apiClient.getSchemas(selCatalog, wsInfo.workspace_url),
    enabled: !!selCatalog,
  });

  const upsert = useMutation({
    mutationFn: (v: { catalog: string; schema: string; is_active: boolean }) =>
      apiClient.postScope(v.catalog, v.schema, v.is_active, wsInfo.workspace_url),
    onSuccess: (_data, v) => {
      queryClient.invalidateQueries({ queryKey: ['scope'] });
      toast.success(`Added ${v.catalog}.${v.schema} to scope`);
    },
    onError: (err: Error) => toast.error(`Failed to update scope: ${err.message}`),
  });

  const remove = useMutation({
    mutationFn: (v: ScopeEntry) =>
      apiClient.deleteScope(v.workspace_url, v.catalog_name, v.schema_name),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ['scope'] });
      toast.success(`Removed ${v.catalog_name}.${v.schema_name} from scope`);
    },
    onError: (err: Error) => toast.error(`Failed to remove scope entry: ${err.message}`),
  });

  const handleAdd = () => {
    if (!selCatalog || !selSchema) {
      toast.warning('Select a catalog and schema first');
      return;
    }
    upsert.mutate({ catalog: selCatalog, schema: selSchema, is_active: true });
    setSelSchema('');
  };

  const dot = wsInfo.is_primary ? 'bg-green-500' : 'bg-purple-500';

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
        <span className="font-medium">Workspace: {wsInfo.display_name}</span>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
          {wsInfo.workspace_url}
        </span>
      </div>
      <div className="px-5 py-4 space-y-4">
        {catalogsQuery.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            Failed to load catalogs: {(catalogsQuery.error as Error).message}
          </div>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Catalog</label>
            <select
              className="border border-gray-300 rounded px-3 py-1.5 text-sm min-w-48"
              value={selCatalog}
              onChange={(e) => { setSelCatalog(e.target.value); setSelSchema(''); }}
            >
              <option value="">{catalogsQuery.isLoading ? 'Loading…' : 'Select…'}</option>
              {(catalogsQuery.data ?? []).map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Schema</label>
            <input
              list={`schema-options-${wsInfo.workspace_url}`}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm min-w-48"
              value={selSchema}
              onChange={(e) => setSelSchema(e.target.value)}
              disabled={!selCatalog}
              placeholder={schemasQuery.isLoading ? 'Loading…' : 'Select or type…'}
            />
            <datalist id={`schema-options-${wsInfo.workspace_url}`}>
              {(schemasQuery.data ?? []).map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </div>
          <button
            onClick={handleAdd}
            disabled={!selCatalog || !selSchema || upsert.isPending}
            className="px-4 py-2 text-sm rounded bg-brand text-white hover:opacity-90 disabled:opacity-50"
          >
            {upsert.isPending ? 'Adding…' : 'Add to scope'}
          </button>
        </div>
        <ScopeTable
          entries={entries}
          onToggle={(s, active) => upsert.mutate({ catalog: s.catalog_name, schema: s.schema_name, is_active: active })}
          onRemove={(s) => remove.mutate(s)}
        />
      </div>
    </div>
  );
}

export function TagDictionarySection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const dictQuery = useQuery<TagDictEntry[]>({
    queryKey: ['tagdictionary'],
    queryFn: apiClient.getTagDictionary,
  });

  const [tagKey, setTagKey] = useState('');
  const [allowed, setAllowed] = useState('');
  const [freeText, setFreeText] = useState(false);

  const upsert = useMutation({
    mutationFn: (v: { tag_key: string; allowed_values: string[] | null; free_text: boolean }) =>
      apiClient.postTagDictionary(v.tag_key, v.allowed_values, v.free_text),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ['tagdictionary'] });
      toast.success(`Saved tag key "${v.tag_key}"`);
    },
    onError: (err: Error) => toast.error(`Failed to save tag key: ${err.message}`),
  });

  const remove = useMutation({
    mutationFn: (key: string) => apiClient.deleteTagDictionary(key),
    onSuccess: (_, key) => {
      queryClient.invalidateQueries({ queryKey: ['tagdictionary'] });
      toast.success(`Deleted tag key "${key}"`);
    },
    onError: (err: Error) => toast.error(`Failed to delete tag key: ${err.message}`),
  });

  const reorder = useMutation({
    mutationFn: (keys: string[]) => apiClient.putTagOrder(keys),
    onMutate: (keys) => {
      // Optimistic update — reorder the cached list immediately
      queryClient.setQueryData<TagDictEntry[]>(['tagdictionary'], (prev) => {
        if (!prev) return prev;
        return keys.map((k) => prev.find((e) => e.tag_key === k)!).filter(Boolean);
      });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['tagdictionary'] });
      toast.error('Failed to save tag order');
    },
  });

  const moveKey = (index: number, direction: 'up' | 'down') => {
    const entries = dictQuery.data ?? [];
    const keys = entries.map((e) => e.tag_key);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= keys.length) return;
    [keys[index], keys[swapWith]] = [keys[swapWith], keys[index]];
    reorder.mutate(keys);
  };

  const parsedAllowed = useMemo(
    () => allowed.split(',').map((v) => v.trim()).filter(Boolean),
    [allowed]
  );

  const handleAdd = () => {
    if (!tagKey.trim()) {
      toast.warning('Tag key cannot be empty');
      return;
    }
    upsert.mutate({
      tag_key: tagKey.trim(),
      allowed_values: parsedAllowed.length ? parsedAllowed : null,
      free_text: freeText,
    });
    setTagKey('');
    setAllowed('');
    setFreeText(false);
  };

  const editRow = (entry: TagDictEntry) => {
    setTagKey(entry.tag_key);
    setAllowed((entry.allowed_values ?? []).join(', '));
    setFreeText(entry.free_text);
  };

  const entries = dictQuery.data ?? [];

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-5 py-3 border-b border-gray-200 font-medium">
        Tag dictionary
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tag key</label>
            <input
              className="border border-gray-300 rounded px-3 py-1.5 text-sm"
              value={tagKey}
              onChange={(e) => setTagKey(e.target.value)}
              placeholder="e.g. sensitivity"
            />
          </div>
          <div className="flex-1 min-w-64">
            <label className="block text-xs text-gray-500 mb-1">
              Allowed values (comma-separated, blank = any)
            </label>
            <input
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
              placeholder="public, internal, confidential"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={freeText}
              onChange={(e) => setFreeText(e.target.checked)}
            />
            Free text
          </label>
          <button
            onClick={handleAdd}
            disabled={!tagKey.trim() || upsert.isPending}
            className="px-4 py-2 text-sm rounded bg-brand text-white hover:opacity-90 disabled:opacity-50"
          >
            {upsert.isPending ? 'Saving…' : 'Save key'}
          </button>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              <th className="px-4 py-2 w-16">Order</th>
              <th className="px-4 py-2">Tag key</th>
              <th className="px-4 py-2">Allowed values</th>
              <th className="px-4 py-2">Free text</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, idx) => (
              <tr key={e.tag_key} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-0.5">
                    <button
                      disabled={idx === 0 || reorder.isPending}
                      onClick={() => moveKey(idx, 'up')}
                      title="Move up"
                      className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed text-gray-500"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l4-4 4 4" />
                      </svg>
                    </button>
                    <button
                      disabled={idx === entries.length - 1 || reorder.isPending}
                      onClick={() => moveKey(idx, 'down')}
                      title="Move down"
                      className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed text-gray-500"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 5l4 4 4-4" />
                      </svg>
                    </button>
                  </div>
                </td>
                <td className="px-4 py-2 font-medium">{e.tag_key}</td>
                <td className="px-4 py-2">
                  {e.allowed_values && e.allowed_values.length
                    ? e.allowed_values.join(', ')
                    : <span className="text-gray-400">any</span>}
                </td>
                <td className="px-4 py-2">{e.free_text ? 'yes' : 'no'}</td>
                <td className="px-4 py-2 text-right space-x-3">
                  <button onClick={() => editRow(e)} className="text-brand hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => remove.mutate(e.tag_key)}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No tag keys defined yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceTab({
  workspaces,
  currentWorkspace,
  onWorkspaceChange,
}: {
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  onWorkspaceChange: (ws: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-5">
      {/* Workspace selector */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200 font-medium text-sm text-gray-700">Select Workspace</div>
        <div className="px-5 py-4 flex flex-wrap gap-3">
          {workspaces.map((w) => {
            const selected = w.workspace_url === currentWorkspace?.workspace_url;
            const dot = 'bg-green-500';
            return (
              <button
                key={w.workspace_url}
                onClick={() => onWorkspaceChange(w.workspace_url)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'border-brand bg-brand/5 text-brand font-medium'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <span>{w.display_name || w.workspace_url}</span>
                {selected && <span className="text-xs text-brand/60 font-normal ml-1">active</span>}
              </button>
            );
          })}
        </div>
        {currentWorkspace && (
          <div className="px-5 pb-4 text-xs text-gray-400 font-mono">{currentWorkspace.workspace_url}</div>
        )}
      </div>

      {/* Scope for active workspace */}
      <IdentityBanner />
      {currentWorkspace && <ScopeSection wsInfo={currentWorkspace} />}

      {/* Add Secondary Workspace — collapsible */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setAddOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
        >
          <span>Add Secondary Workspace</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${addOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {addOpen && (
          <div className="border-t border-gray-200 px-5 py-4">
            <Instructions />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings({
  currentWorkspace,
  workspaces,
  onWorkspaceChange,
}: {
  currentWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  onWorkspaceChange: (ws: string) => void;
}) {
  return (
    <WorkspaceTab
      workspaces={workspaces}
      currentWorkspace={currentWorkspace}
      onWorkspaceChange={onWorkspaceChange}
    />
  );
}
