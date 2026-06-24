import { useQuery } from '@tanstack/react-query';
import apiClient, { OverviewMetrics, PerSchemaMetric } from '../api/client';

function pct(n: number, d: number) {
  return d > 0 ? Math.round((100 * n) / d) : 0;
}

function MetricCard({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-brand-dark">
        {value}
        {suffix && <span className="text-lg text-gray-400 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

function Bar({ p }: { p: number }) {
  return (
    <div className="w-full bg-gray-100 rounded h-2">
      <div className="bg-brand h-2 rounded" style={{ width: `${Math.min(100, p)}%` }} />
    </div>
  );
}

function aggregate(rows: PerSchemaMetric[]) {
  const t = rows.reduce(
    (acc, s) => ({
      tables_total: acc.tables_total + s.tables_total,
      tables_tagged: acc.tables_tagged + s.tables_tagged,
      tables_commented: acc.tables_commented + s.tables_commented,
      columns_total: acc.columns_total + s.columns_total,
      columns_commented: acc.columns_commented + s.columns_commented,
    }),
    { tables_total: 0, tables_tagged: 0, tables_commented: 0, columns_total: 0, columns_commented: 0 },
  );
  return {
    ...t,
    tables_tagged_pct: pct(t.tables_tagged, t.tables_total),
    tables_commented_pct: pct(t.tables_commented, t.tables_total),
    columns_commented_pct: pct(t.columns_commented, t.columns_total),
  };
}

export default function Overview({ workspace }: { workspace: string }) {
  const { data, isLoading, error } = useQuery<OverviewMetrics>({
    queryKey: ['overview-metrics'],
    queryFn: apiClient.getOverviewMetrics,
  });

  if (isLoading) return <div className="text-gray-500">Loading metrics…</div>;
  if (error)
    return (
      <div className="text-red-600">
        Failed to load metrics: {(error as Error).message}
      </div>
    );
  if (!data) return null;

  const rows = data.per_schema.filter((s) => s.workspace_url === workspace);
  const totals = aggregate(rows);

  if (rows.length === 0) {
    return (
      <div className="text-gray-500">
        No active scope entries for this workspace. Add catalogs and schemas in the Configuration tab.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Tables in scope" value={totals.tables_total} />
        <MetricCard label="Tables tagged" value={totals.tables_tagged_pct} suffix="%" />
        <MetricCard label="Tables commented" value={totals.tables_commented_pct} suffix="%" />
        <MetricCard label="Columns commented" value={totals.columns_commented_pct} suffix="%" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200 font-medium">
          Per-schema breakdown
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-2">Catalog</th>
                <th className="px-4 py-2">Schema</th>
                <th className="px-4 py-2">Tables</th>
                <th className="px-4 py-2 w-48">Tagged</th>
                <th className="px-4 py-2 w-48">Commented</th>
                <th className="px-4 py-2 w-48">Columns commented</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={`${s.catalog}.${s.schema}`} className="border-t border-gray-100">
                  <td className="px-4 py-2">{s.catalog}</td>
                  <td className="px-4 py-2">
                    {s.schema}
                    {s.error && <span className="ml-2 text-xs text-red-500">(read error)</span>}
                  </td>
                  <td className="px-4 py-2">{s.tables_total}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Bar p={s.tables_tagged_pct} />
                      <span className="text-xs text-gray-500 w-10 text-right">{s.tables_tagged_pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Bar p={s.tables_commented_pct} />
                      <span className="text-xs text-gray-500 w-10 text-right">{s.tables_commented_pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Bar p={s.columns_commented_pct} />
                      <span className="text-xs text-gray-500 w-10 text-right">{s.columns_commented_pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
