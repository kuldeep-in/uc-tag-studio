import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.detail || err.response?.data?.message || err.message;
  }
  return (err as Error).message ?? String(err);
}

export function normalizeWorkspaceUrl(url: string): string {
  return (url || '').trim().replace(/\/$/, '');
}

// --- Types ---
export interface CatalogInfo {
  name: string;
  comment?: string | null;
}

export interface SchemaInfo {
  name: string;
  catalog_name: string;
  comment?: string | null;
}

export interface TableInfo {
  full_name: string;
  catalog_name: string;
  schema_name: string;
  workspace_url: string;
  name: string;
  table_type?: string;
  tag_count: number;
  tags: Record<string, string>;
}

export interface TagDictEntry {
  tag_key: string;
  allowed_values: string[] | null;
  free_text: boolean;
  sort_order: number | null;
}

export interface WorkspaceInfo {
  workspace_url: string;
  display_name: string;
  is_primary: boolean;
}

export interface ScopeEntry {
  workspace_url: string;
  catalog_name: string;
  schema_name: string;
  is_active: boolean;
}

export interface AppIdentity {
  user_name: string;
  display_name: string;
  is_service_principal: boolean;
  sql_warehouse_id: string;
  config_catalog: string;
  config_schema: string;
}

export interface PerSchemaMetric {
  workspace_url: string;
  catalog: string;
  schema: string;
  tables_total: number;
  tables_tagged: number;
  tables_tagged_pct: number;
  error: boolean;
}

export interface OverviewMetrics {
  tables_total: number;
  tables_tagged_pct: number;
  tables_tagged: number;
  per_schema: PerSchemaMetric[];
}

export interface SetupCheck {
  id: string;
  step: number;
  label: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  fix_sql: string | null;
  fix_where: string | null;
  check_group_id: string;
  check_group_label: string;
}

export interface PermissionEntry {
  id: string;
  group: string;
  resource: string;
  privilege: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  fix_sql: string | null;
  fix_where: string | null;
  check_group_id: string;
  check_group_label: string;
}

export interface CachedCheckRow {
  check_group_id: string;
  check_group_label: string;
  workspace_url: string | null;
  check_id: string;
  check_type: 'check' | 'permission';
  step: number | null;
  label: string | null;
  perm_group: string | null;
  resource: string | null;
  privilege: string | null;
  status: 'ok' | 'warning' | 'error';
  message: string | null;
  fix_sql: string | null;
  fix_where: string | null;
  checked_at: string;
  sp_client_id: string | null;
}

export interface PermTableNode {
  name: string;
  privileges: string[];
}

export interface PermSchemaNode {
  name: string;
  role: string;
  privileges: string[];
  tables: PermTableNode[];
}

export interface PermCatalogNode {
  name: string;
  roles: string[];
  privileges: string[];
  schemas: PermSchemaNode[];
}

export interface PermWarehouseNode {
  id: string;
  accessible: boolean;
  privileges: string[];
}

export interface PermissionsTree {
  warehouse: PermWarehouseNode | null;
  catalogs: PermCatalogNode[];
}

export interface SetupStatus {
  sp_client_id: string;
  config_catalog: string;
  config_schema: string;
  sql_warehouse_id: string;
  checks: SetupCheck[];
  permissions: PermissionEntry[];
}

// --- Endpoints ---
export const apiClient = {
  // catalogs / schemas / tables
  getCatalogs: (workspace_url = 'primary') =>
    api.get<CatalogInfo[]>('/catalogs', { params: { workspace_url } }).then((r) => r.data),
  getSchemas: (catalog: string, workspace_url = 'primary') =>
    api.get<SchemaInfo[]>('/schemas', { params: { catalog, workspace_url } }).then((r) => r.data),
  getWorkspaces: () =>
    api.get<WorkspaceInfo[]>('/config/workspaces').then((r) => r.data),
  getTables: (catalog: string, schema: string, workspace_url = 'primary') =>
    api
      .get<TableInfo[]>('/tables', { params: { catalog, schema, workspace_url } })
      .then((r) => r.data),

  // overview
  getOverviewMetrics: () =>
    api.get<OverviewMetrics>('/overview/metrics').then((r) => r.data),

  // tags
  getTableTags: (fullName: string) =>
    api
      .get<{ full_name: string; tags: Record<string, string> }>(
        `/tags/table/${fullName}`
      )
      .then((r) => r.data),
  patchTableTags: (fullName: string, tags: Record<string, string>, workspace_url = 'primary') =>
    api.patch(`/tags/table/${fullName}`, { tags, workspace_url }).then((r) => r.data),

  // config — scope
  getScope: () => api.get<ScopeEntry[]>('/config/scope').then((r) => r.data),
  postScope: (catalog: string, schema: string, is_active: boolean, workspace_url = 'primary') =>
    api.post('/config/scope', { catalog, schema, is_active, workspace_url }).then((r) => r.data),
  deleteScope: (workspace_url: string, catalog: string, schema: string) =>
    api.delete('/config/scope', { data: { workspace_url, catalog, schema } }).then((r) => r.data),

  // app identity
  getAppIdentity: () => api.get<AppIdentity>('/config/identity').then((r) => r.data),

  // permissions tree
  getPermissionsTree: () => api.get<PermissionsTree>('/config/permissions-tree').then((r) => r.data),

  // setup validation
  getSetupStatus: () => api.get<SetupStatus>('/config/setup-status').then((r) => r.data),
  getCachedSetupStatus: () =>
    api.get<CachedCheckRow[]>('/config/setup-status/cached').then((r) => r.data),

  // config — tag dictionary
  getTagDictionary: () =>
    api.get<TagDictEntry[]>('/config/tagdictionary').then((r) => r.data),
  postTagDictionary: (
    tag_key: string,
    allowed_values: string[] | null,
    free_text: boolean
  ) =>
    api
      .post('/config/tagdictionary', { tag_key, allowed_values, free_text })
      .then((r) => r.data),
  deleteTagDictionary: (tagKey: string) =>
    api.delete(`/config/tagdictionary/${tagKey}`).then((r) => r.data),
  putTagOrder: (orderedKeys: string[]) =>
    api.put('/config/tagdictionary/order', { ordered_keys: orderedKeys }).then((r) => r.data),
};

export default apiClient;
