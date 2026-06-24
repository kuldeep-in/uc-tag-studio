#!/usr/bin/env bash
# setup_secrets.sh — Create a Databricks secret scope and store SP client
# secrets for the Tag Governance cross-region app.
#
# Run this ONCE before the first deploy, and again whenever you rotate a secret.
# The script is idempotent — re-running it is safe.
#
# Usage:
#   chmod +x setup/setup_secrets.sh
#   ./setup/setup_secrets.sh [--profile <cli-profile>] [--scope <scope-name>]
#
# Defaults:
#   --profile  fevm01
#   --scope    tag-governance

set -euo pipefail

PROFILE="fevm01"
SCOPE="tag-governance"
APP_NAME="tag-governance-xregion"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift 2 ;;
    --scope)   SCOPE="$2";   shift 2 ;;
    --app)     APP_NAME="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Databricks Secrets Setup — Tag Governance App         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  CLI profile : $PROFILE"
echo "  Secret scope: $SCOPE"
echo "  App name    : $APP_NAME"
echo ""

# ── Step 1 — Create the secret scope ─────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────"
echo "Step 1/4  Create secret scope"
echo "──────────────────────────────────────────────────────────────"

# Attempt to create; swallow RESOURCE_ALREADY_EXISTS so re-runs are safe.
CREATE_OUT=$(databricks secrets create-scope "$SCOPE" -p "$PROFILE" 2>&1 || true)
if echo "$CREATE_OUT" | grep -qi "already exists"; then
  echo "  Scope '$SCOPE' already exists — skipping creation."
elif [[ -n "$CREATE_OUT" ]] && echo "$CREATE_OUT" | grep -qi "error"; then
  echo "  ERROR: $CREATE_OUT"
  exit 1
else
  echo "  Scope '$SCOPE' created."
fi
echo ""

# ── Step 2 — Store SP secrets ─────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────"
echo "Step 2/4  Store SP client secrets"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  How many secondary workspaces do you want to configure?"
echo "  (Enter a number, e.g. 1)"
printf "  > "
read -r NUM_WS

re_int='^[0-9]+$'
if ! [[ $NUM_WS =~ $re_int ]] || [[ $NUM_WS -lt 1 ]]; then
  echo "  ERROR: Please enter a positive integer."
  exit 1
fi

for i in $(seq 1 "$NUM_WS"); do
  echo ""
  echo "  [Workspace $i]"

  KEY_ID="sec-${i}-sp-client-id"
  echo "  Enter the SP client ID (application UUID) for SEC_${i}:"
  printf "  > "
  read -r SP_CLIENT_ID
  databricks secrets put-secret "$SCOPE" "$KEY_ID" --string-value "$SP_CLIENT_ID" -p "$PROFILE"
  echo "  Stored. Reference in app.yaml: {{secrets/$SCOPE/$KEY_ID}}"

  KEY_SECRET="sec-${i}-sp-secret"
  echo "  Enter the SP client secret for SEC_${i} (input hidden — paste then press Enter):"
  databricks secrets put-secret "$SCOPE" "$KEY_SECRET" -p "$PROFILE"
  echo "  Stored. Reference in app.yaml: {{secrets/$SCOPE/$KEY_SECRET}}"
done
echo ""

# ── Step 3 — Grant READ to the app service principal ─────────────────────────
echo "──────────────────────────────────────────────────────────────"
echo "Step 3/4  Grant READ on scope to the app service principal"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  The Databricks App runs as a service principal (SP). That SP"
echo "  must have READ on scope '$SCOPE' to access the secrets."
echo ""
echo "  The SP application UUID is printed by 'databricks bundle run'."
echo "  Find it at: Workspace UI → Compute → Apps → $APP_NAME → Service Principal"
echo ""
printf "  Enter the app SP application UUID: "
read -r APP_SP_ID

if [[ -z "$APP_SP_ID" ]]; then
  echo "  Skipping ACL grant (no SP ID provided)."
  echo "  Run manually:"
  echo "    databricks secrets put-acl $SCOPE <SP-UUID> READ -p $PROFILE"
else
  databricks secrets put-acl "$SCOPE" "$APP_SP_ID" READ -p "$PROFILE"
  echo "  READ granted to $APP_SP_ID on scope '$SCOPE'."
fi
echo ""

# ── Step 4 — Verification ─────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────"
echo "Step 4/4  Verification"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  ACLs on scope '$SCOPE':"
databricks secrets list-acls "$SCOPE" -p "$PROFILE" 2>/dev/null || \
  echo "  (run 'databricks secrets list-acls $SCOPE -p $PROFILE' to verify)"
echo ""
echo "  Keys in scope '$SCOPE':"
databricks secrets list-secrets "$SCOPE" -p "$PROFILE" 2>/dev/null || \
  echo "  (run 'databricks secrets list-secrets $SCOPE -p $PROFILE' to verify)"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Done! Next steps                                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  1. Verify app.yaml has SEC_N_SP_CLIENT_ID and SEC_N_SP_CLIENT_SECRET set to:"
echo "       {{secrets/$SCOPE/sec-1-sp-client-id}}"
echo "       {{secrets/$SCOPE/sec-1-sp-secret}}"
echo ""
echo "  2. Deploy + start (only needed once after updating app.yaml):"
echo "       npm run build --prefix frontend"
echo "       databricks bundle deploy --target dev -p $PROFILE"
echo "       databricks bundle run $APP_NAME --target dev -p $PROFILE"
echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  To ROTATE credentials later (no redeploy needed):     │"
echo "  │    databricks secrets put-secret $SCOPE sec-1-sp-client-id \\"
echo "  │      --string-value <new-uuid> -p $PROFILE             │"
echo "  │    databricks secrets put-secret $SCOPE sec-1-sp-secret -p $PROFILE"
echo "  │    databricks apps stop  $APP_NAME -p $PROFILE          │"
echo "  │    databricks apps start $APP_NAME -p $PROFILE          │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""
