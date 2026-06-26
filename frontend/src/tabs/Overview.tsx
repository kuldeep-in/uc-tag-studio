import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { OverviewScopeEntry, PerSchemaMetric, TagCoverageEntry, TagDictEntry } from '../api/client';

// ─── Count-up animation ───────────────────────────────────────────────────────
// loading=true  → bounded random walk, oscillates between min and max
// loading=false → ease-out to real target from wherever counter stopped

function useCountUp(target: number, loading: boolean, duration = 900, min = 0, max = Infinity): number {
  const [display, setDisplay] = useState(0);
  const s = useRef({ val: 0, raf: 0 });

  useEffect(() => {
    cancelAnimationFrame(s.current.raf);

    if (loading) {
      let last: number | null = null;
      const tick = (now: number) => {
        if (last === null) last = now;
        const dt = now - last;
        last = now;
        // Truly bidirectional: signed step, bounces between min and max
        const step = (Math.random() - 0.5) * dt * 0.5;
        s.current.val = Math.max(min, Math.min(max, Math.round(s.current.val + step)));
        setDisplay(s.current.val);
        s.current.raf = requestAnimationFrame(tick);
      };
      s.current.raf = requestAnimationFrame(tick);
    } else {
      const from = s.current.val;
      let t0: number | null = null;
      const tick = (now: number) => {
        if (!t0) t0 = now;
        const t = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        s.current.val = Math.round(from + (target - from) * ease);
        setDisplay(s.current.val);
        if (t < 1) s.current.raf = requestAnimationFrame(tick);
      };
      s.current.raf = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(s.current.raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, target]);

  return display;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, suffix, loading, min, max }: {
  label: string; value: number; suffix?: string; loading: boolean; min?: number; max?: number;
}) {
  const animated = useCountUp(value, loading, 1000, min ?? 0, max);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-2 flex items-end gap-1.5">
        <span className={`text-4xl font-bold tabular-nums leading-none transition-colors duration-500 ${
          loading ? 'text-gray-300 dark:text-gray-600' : 'text-brand-dark dark:text-white'
        }`}>
          {animated.toLocaleString()}
        </span>
        {suffix && (
          <span className="text-2xl font-semibold text-gray-300 dark:text-gray-600 mb-0.5">{suffix}</span>
        )}
      </div>
    </div>
  );
}

// ─── Tag coverage card — semicircle gauge ─────────────────────────────────────

const GAUGE_R   = 84;
const GAUGE_CX  = 100;
const GAUGE_CY  = 100;
const GAUGE_ARC = Math.PI * GAUGE_R; // half-circumference ≈ 263.9

function TagGauge({ pct, loading }: { pct: number; loading: boolean }) {
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * GAUGE_ARC;
  const d = `M ${GAUGE_CX - GAUGE_R} ${GAUGE_CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${GAUGE_CX + GAUGE_R} ${GAUGE_CY}`;

  return (
    <svg viewBox="0 0 200 108" className="w-full" aria-hidden="true">
      {/* Track */}
      <path d={d} fill="none" strokeWidth="14" strokeLinecap="round"
        className="stroke-gray-100 dark:stroke-gray-600" />
      {/* Fill — brand-dark in light, teal-400 in dark for contrast */}
      <path d={d} fill="none" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${filled} ${GAUGE_ARC + 2}`}
        className={loading
          ? 'stroke-gray-200 dark:stroke-gray-500'
          : 'stroke-brand-dark dark:stroke-teal-400'}
        style={{ transition: loading ? 'none' : 'stroke-dasharray 0.85s cubic-bezier(0.25, 1, 0.5, 1)' }}
      />
      {/* Percentage number */}
      <text x={GAUGE_CX} y={GAUGE_CY - 10}
        textAnchor="middle" dominantBaseline="auto"
        fontSize="34" fontWeight="700" fontFamily="inherit"
        className={`tabular-nums transition-colors duration-500 ${
          loading ? 'fill-gray-300 dark:fill-gray-600' : 'fill-brand-dark dark:fill-teal-400'
        }`}
      >
        {pct}
      </text>
      <text x={GAUGE_CX + 28} y={GAUGE_CY - 14}
        textAnchor="middle" dominantBaseline="auto"
        fontSize="18" fontWeight="600" fontFamily="inherit"
        className="fill-gray-300 dark:fill-gray-500"
      >
        %
      </text>
    </svg>
  );
}

// ─── Coverage gauge card (overall tables-tagged %) ────────────────────────────

function CoverageCard({ pct, tagged, total, loading }: {
  pct: number; tagged: number; total: number; loading: boolean;
}) {
  const animated = useCountUp(pct, loading, 900, 0, 99);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-4 pt-4 pb-5 flex flex-col">
      <TagGauge pct={animated} loading={loading} />
      <div className="text-center mt-0.5">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Tables tagged</span>
      </div>
      <div className="text-center mt-1 h-4">
        {!loading && total > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {tagged.toLocaleString()} / {total.toLocaleString()} tables
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Tag coverage card ────────────────────────────────────────────────────────

function TagCard({ entry, loading }: { entry: TagCoverageEntry | null; loading: boolean }) {
  const pct = entry ? Math.round(entry.pct) : 0;
  const animated = useCountUp(pct, loading, 900, 0, 99);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-4 pt-4 pb-5 flex flex-col">
      <TagGauge pct={animated} loading={loading} />

      <div className="text-center mt-0.5">
        {loading || !entry ? (
          <div className="h-4 w-28 mx-auto rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
        ) : (
          <span className="text-sm font-semibold font-mono text-gray-800 dark:text-gray-100 truncate block"
            title={entry.tag_key}>
            {entry.tag_key}
          </span>
        )}
      </div>

      <div className="text-center mt-1 h-4">
        {!loading && entry && (
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {entry.tables_tagged.toLocaleString()} / {entry.tables_total.toLocaleString()} tables
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function Bar({ pct }: { pct: number }) {
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = setTimeout(() => setWidth(pct), 80); return () => clearTimeout(t); }, [pct]);
  return (
    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
      <div className="bg-brand h-1.5 rounded-full transition-all duration-700 ease-out"
           style={{ width: `${Math.min(100, width)}%` }} />
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-100 dark:bg-gray-700 rounded animate-pulse ${className}`} />;
}

// ─── Catalog group fetcher ────────────────────────────────────────────────────
// Fires ONE SQL (one HTTP request) for all schemas in the same catalog+workspace.

interface CatalogGroup { workspaceUrl: string; catalog: string; schemas: string[] }

function CatalogGroupRows({
  group, scopeOrder, onResolved,
}: {
  group: CatalogGroup;
  scopeOrder: string[];   // ordered schema names for row positioning
  onResolved: (key: string, data: PerSchemaMetric) => void;
}) {
  const { data, isLoading, isError } = useQuery<PerSchemaMetric[]>({
    queryKey: ['catalog-metrics', group.workspaceUrl, group.catalog, ...group.schemas.slice().sort()],
    queryFn: () => apiClient.getCatalogMetrics(group.catalog, group.schemas, group.workspaceUrl),
    staleTime: 300_000,   // 5 min — matches backend cache TTL
    retry: 1,
  });

  const bySchema = useMemo(() => {
    const m = new Map<string, PerSchemaMetric>();
    data?.forEach((r) => m.set(r.schema, r));
    return m;
  }, [data]);

  // Notify parent for each resolved schema (success or error — parent decides how to count)
  const notified = useRef(new Set<string>());
  useEffect(() => {
    if (isLoading) return;
    // HTTP-level error: synthesise zero-rows so parent knows this group is done
    if (!data || isError) {
      group.schemas.forEach((schema) => {
        const key = `${group.workspaceUrl}:${group.catalog}.${schema}`;
        if (!notified.current.has(key)) {
          notified.current.add(key);
          onResolved(key, { workspace_url: group.workspaceUrl, catalog: group.catalog, schema,
            tables_total: 0, tables_tagged: 0, tables_tagged_pct: 0, error: true });
        }
      });
      return;
    }
    data.forEach((d) => {
      const key = `${d.workspace_url}:${d.catalog}.${d.schema}`;
      if (!notified.current.has(key)) {
        notified.current.add(key);
        onResolved(key, d);
      }
    });
  }, [data, isLoading, isError, group, onResolved]);

  return (
    <>
      {scopeOrder.map((schema) => {
        const d = bySchema.get(schema);
        return (
          <SchemaRow
            key={schema}
            catalog={group.catalog}
            schema={schema}
            data={d}
            loading={isLoading}
            error={isError || (!!d && d.error)}
            errorDetail={(d as any)?.error_detail}
          />
        );
      })}
    </>
  );
}

// ─── Schema row ───────────────────────────────────────────────────────────────

function SchemaRow({ catalog, schema, data, loading, error, errorDetail }: {
  catalog: string; schema: string;
  data?: PerSchemaMetric; loading: boolean; error: boolean; errorDetail?: string;
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-gray-700/40 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
        {catalog}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
        {schema}
        {error && (
          <span className="ml-2 text-xs text-red-500 dark:text-red-400" title={errorDetail}>
            read error
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300 w-28">
        {loading ? <Skeleton className="h-3.5 w-12 ml-auto" /> : (data?.tables_total ?? 0).toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300 w-24">
        {loading ? <Skeleton className="h-3.5 w-10 ml-auto" /> : (data?.tables_tagged ?? 0).toLocaleString()}
      </td>
      <td className="px-4 py-3 w-52">
        {loading ? (
          <Skeleton className="h-1.5 w-full" />
        ) : (
          <div className="flex items-center gap-2">
            <Bar pct={data?.tables_tagged_pct ?? 0} />
            <span className="text-xs text-gray-500 dark:text-gray-400 w-9 text-right shrink-0 tabular-nums">
              {data?.tables_tagged_pct ?? 0}%
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Overview({ workspace }: { workspace: string }) {
  const { data: scopes = [], isLoading: scopesLoading, error: scopesError } = useQuery<OverviewScopeEntry[]>({
    queryKey: ['overview-scopes', workspace],
    queryFn: () => apiClient.getOverviewScopes(workspace),
    staleTime: 300_000,
    enabled: !!workspace,
  });

  // Group by (workspace_url, catalog) → one SQL per group
  const catalogGroups = useMemo<CatalogGroup[]>(() => {
    const map = new Map<string, CatalogGroup>();
    for (const s of scopes) {
      const key = `${s.workspace_url}::${s.catalog}`;
      if (!map.has(key)) map.set(key, { workspaceUrl: s.workspace_url, catalog: s.catalog, schemas: [] });
      map.get(key)!.schemas.push(s.schema);
    }
    return [...map.values()];
  }, [scopes]);

  // Accumulate totals as catalog groups resolve
  const resolvedRef = useRef<Map<string, PerSchemaMetric>>(new Map());
  const [totals, setTotals] = useState({ total: 0, tagged: 0 });
  const [hasReceived, setHasReceived] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Safety net: stop loading animation after 12s regardless of data state
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, []);

  const handleResolved = useCallback((key: string, d: PerSchemaMetric) => {
    resolvedRef.current.set(key, d);
    let t = 0, g = 0;
    resolvedRef.current.forEach((r) => { t += r.tables_total; g += r.tables_tagged; });
    setTotals({ total: t, tagged: g });
    setHasReceived(true);
  }, []);

  const pct = totals.total > 0 ? Math.round((100 * totals.tagged) / totals.total) : 0;
  const topLoading = !timedOut && (scopesLoading || (catalogGroups.length > 0 && !hasReceived));

  // Tag dictionary — already cached by Configuration/TagManagement; no extra SQL
  const { data: tagDict = [], isLoading: tagDictLoading } = useQuery<TagDictEntry[]>({
    queryKey: ['tagdictionary'],
    queryFn: apiClient.getTagDictionary,
    staleTime: 300_000,
  });

  // Only request coverage for the top 2 tags by dict order — avoids scanning all tags
  const top2Keys = useMemo(() => tagDict.slice(0, 2).map((d) => d.tag_key), [tagDict]);

  const { data: tagCoverage = [], isLoading: tagCoverageLoading } = useQuery<TagCoverageEntry[]>({
    queryKey: ['tag-coverage', workspace, top2Keys],
    queryFn: () => apiClient.getTagCoverage(workspace, top2Keys),
    staleTime: 300_000,
    enabled: !!workspace && top2Keys.length > 0,
  });

  // Top 2 by tag dictionary order (sort_order), not by coverage %
  const top2 = useMemo(() => {
    const coverageMap = new Map(tagCoverage.map((e) => [e.tag_key, e]));
    return tagDict.slice(0, 2).map(
      (d) => coverageMap.get(d.tag_key) ?? { tag_key: d.tag_key, tables_tagged: 0, tables_total: 0, pct: 0 }
    );
  }, [tagDict, tagCoverage]);

  const tagLoading = topLoading || tagCoverageLoading || tagDictLoading;

  if (scopesError) return (
    <div className="text-red-600 dark:text-red-400 text-sm">
      Failed to load scope: {(scopesError as Error).message}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Tables in scope" value={totals.total} loading={topLoading} min={10} max={800} />
        <CoverageCard pct={pct} tagged={totals.tagged} total={totals.total} loading={topLoading} />
        <TagCard entry={top2[0] ?? null} loading={tagLoading} />
        <TagCard entry={top2[1] ?? null} loading={tagLoading} />
      </div>

      {/* Per-schema table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Per-schema breakdown</span>
          {!scopesLoading && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {scopes.length} schema{scopes.length !== 1 ? 's' : ''} · {catalogGroups.length} SQL {catalogGroups.length !== 1 ? 'queries' : 'query'}
            </span>
          )}
        </div>

        {!scopesLoading && scopes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            No active scope entries for this workspace. Add catalogs and schemas in the Settings tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Catalog</th>
                  <th className="px-4 py-2.5 text-left font-medium">Schema</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tables</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tagged</th>
                  <th className="px-4 py-2.5 text-left font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {scopesLoading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-3"><Skeleton className="h-3.5 w-28" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-3.5 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-3.5 w-12 ml-auto" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-3.5 w-10 ml-auto" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-1.5 w-full" /></td>
                      </tr>
                    ))
                  : catalogGroups.map((group) => {
                      const groupScopes = scopes
                        .filter((s) => s.catalog === group.catalog && s.workspace_url === group.workspaceUrl)
                        .map((s) => s.schema);
                      return (
                        <CatalogGroupRows
                          key={`${group.workspaceUrl}::${group.catalog}`}
                          group={group}
                          scopeOrder={groupScopes}
                          onResolved={handleResolved}
                        />
                      );
                    })
                }
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
