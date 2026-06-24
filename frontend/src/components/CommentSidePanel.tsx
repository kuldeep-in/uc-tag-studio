import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';

export interface CommentTarget {
  type: 'table' | 'column';
  full_name: string;
  column_name?: string;
  label: string;
  comment: string;
}

interface Props {
  target: CommentTarget;
  onClose: () => void;
}

export default function CommentSidePanel({ target, onClose }: Props) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState(target.comment);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      target.type === 'table'
        ? apiClient.patchTableComment(target.full_name, value)
        : apiClient.patchColumnComment(
            target.full_name,
            target.column_name!,
            value
          ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['columns'] });
      queryClient.invalidateQueries({ queryKey: ['overview-metrics'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="text-xs uppercase tracking-wide text-gray-400">
            {target.type} comment
          </div>
          <div className="font-medium break-all">{target.label}</div>
        </div>
        <div className="px-5 py-4 flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Comment
          </label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm h-48"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {mutation.isError && (
            <div className="text-sm text-red-600 mt-2">
              {(mutation.error as Error).message}
            </div>
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
            onClick={() => mutation.mutate(comment)}
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
