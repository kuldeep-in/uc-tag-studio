import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { BulkTarget } from '../api/client';

interface Props {
  targets: BulkTarget[];
  onClear: () => void;
}

export default function BulkCommentBar({ targets, onClear }: Props) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiClient.bulkComment(targets, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['columns'] });
      queryClient.invalidateQueries({ queryKey: ['overview-metrics'] });
      setComment('');
      onClear();
    },
  });

  if (targets.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-brand-dark text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3">
        <span className="text-sm font-medium whitespace-nowrap">
          {targets.length} item{targets.length > 1 ? 's' : ''} selected
        </span>
        <input
          className="flex-1 rounded px-3 py-2 text-sm text-gray-900"
          placeholder="Comment to apply to all selected…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-2 text-sm rounded bg-brand hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? 'Applying…' : 'Apply'}
        </button>
        <button
          onClick={onClear}
          className="px-3 py-2 text-sm rounded border border-white/30 hover:bg-white/10"
        >
          Clear
        </button>
      </div>
      {mutation.isError && (
        <div className="max-w-7xl mx-auto px-6 pb-2 text-sm text-red-200">
          {(mutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
