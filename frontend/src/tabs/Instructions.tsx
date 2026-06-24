import { useState } from 'react';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handle}
      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-sm font-semibold">
        {n}
      </div>
      <div className="flex-1 pb-6">
        <h3 className="font-medium text-gray-900 mb-2">{title}</h3>
        <div className="text-sm text-gray-600 space-y-3">{children}</div>
      </div>
    </div>
  );
}

const GRANTS_SECTION1 = `-- ============================================================
-- VARIABLES — set once, covers all current and future schemas
-- ============================================================
DECLARE OR REPLACE VARIABLE v_sp_id   STRING DEFAULT '<service_principal_app_id>';
DECLARE OR REPLACE VARIABLE v_catalog STRING DEFAULT '<target_catalog>';

-- Catalog navigation
GRANT USE CATALOG ON CATALOG IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);

-- Schema navigation — catalog-level grant cascades to ALL schemas (current and future)
GRANT USE SCHEMA ON CATALOG IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);

-- Tag writes — catalog-level grant cascades to ALL schemas (current and future)
GRANT APPLY TAG ON CATALOG IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);`;

const GRANTS_SECTION2 = `-- ============================================================
-- VARIABLES — declare one v_schema_N per schema
-- ============================================================
DECLARE OR REPLACE VARIABLE v_sp_id    STRING DEFAULT '<service_principal_app_id>';
DECLARE OR REPLACE VARIABLE v_catalog  STRING DEFAULT '<target_catalog>';
DECLARE OR REPLACE VARIABLE v_schema_1 STRING DEFAULT '<schema_name_1>';
DECLARE OR REPLACE VARIABLE v_schema_2 STRING DEFAULT '<schema_name_2>';

-- Schema ownership is required to write table and column comments.
-- Run once per schema. Repeat for each schema the SP will manage.
ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_1) OWNER TO IDENTIFIER(v_sp_id);
ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_2) OWNER TO IDENTIFIER(v_sp_id);

-- Adding a new schema later? Just add:
-- DECLARE OR REPLACE VARIABLE v_schema_3 STRING DEFAULT '<schema_name_3>';
-- ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_3) OWNER TO IDENTIFIER(v_sp_id);`;

const APP_YAML_BLOCK = `# In app.yaml, uncomment and fill in the SEC_1_* block (add SEC_2_*, SEC_3_* for more):

- name: SEC_1_WORKSPACE_URL
  value: "https://adb-<id>.azuredatabricks.net"
- name: SEC_1_DISPLAY_NAME
  value: "My Secondary Region"
- name: SEC_1_SP_CLIENT_ID
  value: "<service-principal-application-id>"
- name: SEC_1_SP_CLIENT_SECRET
  value: "{{secrets/tag-governance/sec-1-sp-secret}}"
- name: SEC_1_SQL_WAREHOUSE_ID
  value: "<warehouse-id-in-secondary-workspace>"`;

const SECRET_CMD = `# Store the SP client secret in Databricks Secrets (run once in your terminal)
databricks secrets create-scope --scope tag-governance --profile fevm01
databricks secrets put-secret --scope tag-governance --key sec-1-sp-secret --profile fevm01
# (prompts for the secret value — never echoes it to the terminal)`;

const DEPLOY_CMD = `npm run build --prefix frontend && \\
databricks bundle deploy --target dev --profile fevm01 && \\
databricks bundle run tag-governance-xregion --target dev --profile fevm01`;

export default function Instructions() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 text-sm text-blue-800">
        <strong>What is the Secondary Workspace?</strong>
        <p className="mt-1">
          This app manages Unity Catalog tags and comments across regions. The <em>Primary Workspace</em> is
          where this app runs and stores its configuration. A <em>Secondary Workspace</em> is a separate
          Databricks workspace (e.g. in another cloud region) whose UC metadata this app manages remotely
          using a Service Principal.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200 font-medium">
          How to add a Secondary Workspace
        </div>
        <div className="px-5 py-6">
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

            <Step n={1} title="Create a Service Principal (Account Level)">
              <p>Go to <strong>accounts.cloud.databricks.com</strong> → User Management → Service Principals → Add service principal.</p>
              <p>Give it a name, e.g. <code className="bg-gray-100 px-1 rounded">tag-governance-sp</code>.</p>
              <p>After creation, open the SP and copy the <strong>Application (client) ID</strong> — you will need this in Step 5.</p>
            </Step>

            <Step n={2} title="Generate a Client Secret">
              <p>On the SP detail page → open the <strong>Secrets</strong> tab → click <strong>Add secret</strong>.</p>
              <p className="text-amber-700 font-medium">Copy the secret value immediately — it is only shown once.</p>
              <p>You will store this in Databricks Secrets in Step 4 so it never appears in plaintext in <code className="bg-gray-100 px-1 rounded">app.yaml</code>.</p>
            </Step>

            <Step n={3} title="Add the SP to the Secondary Workspace">
              <p>The SP you created in Step 1 lives at the <em>account</em> level. You now need to add it to the <strong>secondary workspace</strong> so it can be granted UC permissions there.</p>
              <p>Open the <strong>secondary workspace</strong> → <strong>Settings → Identity &amp; Access → Service Principals</strong> → <strong>Add service principal</strong>.</p>
              <p>Search by the application ID or name from Step 1 and add it. No workspace-level admin role is needed — Unity Catalog grants in Step 4 control access.</p>
            </Step>

            <Step n={4} title="Grant UC Permissions in the Secondary Workspace">
              <p>Open a SQL editor in the <strong>secondary workspace</strong> and run the two blocks below as a metastore admin or catalog owner.</p>
              <p className="font-medium text-gray-700 pt-1">Section 1 — Catalog-level grants (one-time per catalog)</p>
              <p>Cascades to all current and future schemas — no repeat needed when adding new schemas to scope later.</p>
              <CodeBlock code={GRANTS_SECTION1} />
              <p className="font-medium text-gray-700 pt-2">Section 2 — Per-schema ownership (for comment management only)</p>
              <p>Required to run <code className="bg-gray-100 px-1 rounded">COMMENT ON TABLE</code> and <code className="bg-gray-100 px-1 rounded">ALTER COLUMN COMMENT</code>. Add one line per schema — Section 1 never needs re-running.</p>
              <CodeBlock code={GRANTS_SECTION2} />
              <p className="pt-2">Also grant the SP <strong>Can Use</strong> on a SQL warehouse in the secondary workspace: open the warehouse → <strong>Permissions</strong> → add the SP. Note the <strong>warehouse ID</strong> — needed in Step 5.</p>
            </Step>

            <Step n={5} title="Store the Secret and Update app.yaml">
              <p>Store the client secret in Databricks Secrets so it never appears in plaintext:</p>
              <CodeBlock code={SECRET_CMD} />
              <p className="pt-1">Then open <code className="bg-gray-100 px-1 rounded">app.yaml</code> in the project and uncomment the <code className="bg-gray-100 px-1 rounded">SEC_1_*</code> block, filling in your values. The secret is referenced by scope and key — not stored directly.</p>
              <CodeBlock code={APP_YAML_BLOCK} />
              <p className="pt-1">For a second workspace later, add a <code className="bg-gray-100 px-1 rounded">SEC_2_*</code> block the same way. The app scans for <code className="bg-gray-100 px-1 rounded">SEC_1_</code>, <code className="bg-gray-100 px-1 rounded">SEC_2_</code>, … until it finds a gap.</p>
            </Step>

            <Step n={6} title="Deploy and Restart">
              <p>Build the frontend and redeploy the bundle to pick up the new env vars:</p>
              <CodeBlock code={DEPLOY_CMD} />
              <p>After the app starts, the secondary workspace appears in the <strong>Workspace dropdown in the top navigation bar</strong> (purple dot). Switch to it — all tabs show data for that workspace.</p>
              <p>To add catalogs and schemas from the secondary workspace to scope, switch to it in the navbar, open the <strong>Configuration tab</strong>, and use the Scope section to add entries.</p>
            </Step>
          </div>
        </div>
      </div>
    </div>
  );
}
