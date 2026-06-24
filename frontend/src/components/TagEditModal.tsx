import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { extractErrorMessage, TableInfo, TagDictEntry } from '../api/client';
import { useToast } from './Toast';

interface Props {
  table: TableInfo;
  tagDict: TagDictEntry[];
  onClose: () => void;
}

export default function TagEditModal({ table, tagDict, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({ ...table.tags });

  const configuredKeys = new Set(tagDict.map((e) => e.tag_key));
  const extraTagKeys = Object.keys(table.tags).filter((k) => !configuredKeys.has(k));

  const mutation = useMutation({
    mutationFn: (tags: Record<string, string>) =>
      apiClient.patchTableTags(table.full_name, tags, table.workspace_url ?? 'primary'),
    onSuccess: (_, savedTags) => {
      // Directly update the cached row so the table reflects new values immediately.
      // Relying on invalidate+refetch doesn't work because the UC list endpoint
      // doesn't always return tag values in the response.
      const cacheKey = ['tables', table.workspace_url ?? 'primary', table.catalog_name, table.schema_name];
      queryClient.setQueryData<TableInfo[]>(cacheKey, (prev) =>
        prev?.map((t) =>
          t.full_name === table.full_name
            ? { ...t, tags: savedTags, tag_count: Object.keys(savedTags).length }
            : t
        ) ?? prev
      );
      queryClient.invalidateQueries({ queryKey: ['overview-metrics'] });
      toast.success(`Tags saved for ${table.name}`);
      onClose();
    },
    onError: (err) => toast.error(`Failed to save tags: ${extractErrorMessage(err)}`),
  });

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v != null && v.trim() !== '') cleaned[k] = v;
    }
    mutation.mutate(cleaned);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Edit tags</h2>
          <p className="text-sm text-gray-500 break-all">{table.full_name}</p>
          {table.workspace_url && table.workspace_url !== 'primary' && (
            <p className="text-xs text-purple-600 mt-1">
              Secondary workspace: {table.workspace_url.replace('https://', '')}
            </p>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Configured tags */}
          {tagDict.length === 0 && extraTagKeys.length === 0 && (
            <p className="text-sm text-gray-400">
              No tag keys defined. Add them in the Configuration tab.
            </p>
          )}
          {tagDict.length > 0 && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Configured tags
            </p>
          )}
          {tagDict.map((entry) => {
            const current = values[entry.tag_key] ?? '';
            const hasAllowed = entry.allowed_values && entry.allowed_values.length > 0;
            return (
              <div key={entry.tag_key} className="flex items-center gap-4">
                <label className="w-36 shrink-0 text-sm font-medium text-gray-700">
                  {entry.tag_key}
                  {entry.free_text && (
                    <span className="block text-xs font-normal text-gray-400">free text</span>
                  )}
                </label>
                <div className="flex-1">
                  {hasAllowed && !entry.free_text ? (
                    <select
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      value={current}
                      onChange={(e) => setValue(entry.tag_key, e.target.value)}
                    >
                      <option value="">— none —</option>
                      {entry.allowed_values!.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  ) : hasAllowed && entry.free_text ? (
                    <>
                      <input
                        list={`allowed-${entry.tag_key}`}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        value={current}
                        onChange={(e) => setValue(entry.tag_key, e.target.value)}
                        placeholder="Pick or type a value"
                      />
                      <datalist id={`allowed-${entry.tag_key}`}>
                        {entry.allowed_values!.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <input
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      value={current}
                      onChange={(e) => setValue(entry.tag_key, e.target.value)}
                      placeholder="Enter a value"
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Extra tags — exist on the table but not in the config dictionary */}
          {extraTagKeys.length > 0 && (
            <>
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Additional tags
                  <span className="ml-1.5 font-normal normal-case text-gray-400">
                    (not in config — clear to remove)
                  </span>
                </p>
                <div className="space-y-4">
                  {extraTagKeys.map((k) => (
                    <div key={k} className="flex items-center gap-4">
                      <label className="w-36 shrink-0 text-sm text-gray-500">{k}</label>
                      <input
                        className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm bg-gray-50"
                        value={values[k] ?? ''}
                        onChange={(e) => setValue(k, e.target.value)}
                        placeholder="clear to remove"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm rounded bg-brand text-white hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
