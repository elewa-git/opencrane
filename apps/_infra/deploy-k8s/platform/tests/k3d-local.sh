#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-opencrane-local}"
NAMESPACE="${NAMESPACE:-opencrane-system}"
RELEASE_NAME="${RELEASE_NAME:-opencrane}"
KEEP_CLUSTER="${KEEP_CLUSTER:-1}"
LOCAL_PROFILE="${LOCAL_PROFILE:-default}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
MIN_FREE_GB="${MIN_FREE_GB:-12}"
POSTGRES_RELEASE_NAME="${POSTGRES_RELEASE_NAME:-opencrane-postgres}"
POSTGRES_CREDENTIALS_SECRET="${POSTGRES_CREDENTIALS_SECRET:-opencrane-postgres-credentials}"
FLEET_POSTGRES_CREDENTIALS_SECRET="${FLEET_POSTGRES_CREDENTIALS_SECRET:-opencrane-fleet-postgres-credentials}"
OBOT_POSTGRES_CREDENTIALS_SECRET="${OBOT_POSTGRES_CREDENTIALS_SECRET:-opencrane-obot-postgres-credentials}"
LITELLM_POSTGRES_CREDENTIALS_SECRET="${LITELLM_POSTGRES_CREDENTIALS_SECRET:-opencrane-litellm-postgres-credentials}"
LANGFUSE_POSTGRES_CREDENTIALS_SECRET="${LANGFUSE_POSTGRES_CREDENTIALS_SECRET:-opencrane-langfuse-postgres-credentials}"
POSTGRES_ADMIN_CREDENTIALS_SECRET="${POSTGRES_ADMIN_CREDENTIALS_SECRET:-opencrane-postgres-admin-credentials}"
SILO_POSTGRES_OWNER="${SILO_POSTGRES_OWNER:-opencrane_local}"
FLEET_POSTGRES_OWNER="${FLEET_POSTGRES_OWNER:-opencrane_fleet_local}"
OBOT_POSTGRES_OWNER="${OBOT_POSTGRES_OWNER:-obot_local}"
LITELLM_POSTGRES_OWNER="${LITELLM_POSTGRES_OWNER:-litellm_local}"
LANGFUSE_POSTGRES_OWNER="${LANGFUSE_POSTGRES_OWNER:-langfuse_local}"
POSTGRES_ADMIN_NAME="${POSTGRES_ADMIN_NAME:-opencrane_database_admin}"
DB_PASSWORD="${DB_PASSWORD:-opencrane-local-password}"
FLEET_DB_PASSWORD="${FLEET_DB_PASSWORD:-opencrane-fleet-local-password}"
OBOT_DB_PASSWORD="${OBOT_DB_PASSWORD:-obot-local-password}"
LITELLM_DB_PASSWORD="${LITELLM_DB_PASSWORD:-litellm-local-password}"
LANGFUSE_DB_PASSWORD="${LANGFUSE_DB_PASSWORD:-langfuse-local-password}"
POSTGRES_ADMIN_PASSWORD="${POSTGRES_ADMIN_PASSWORD:-opencrane-admin-local-password}"
CNPG_CHART_VERSION="${CNPG_CHART_VERSION:-0.29.0}"
LITELLM_SECRET_NAME="${LITELLM_SECRET_NAME:-opencrane-litellm}"
LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-opencrane-local-master-key}"
# The fleet-operator app and fleet-platform chart moved to the WeOwnAI repo
# (elewa-git/opencrane#150) and no longer ship in this repo. Point these at a checked-out
# copy of WeOwnAI's apps/fleet-operator and apps/fleet-platform to run this local cluster.
FLEET_OPERATOR_DIR="${FLEET_OPERATOR_DIR:-}"
FLEET_CHART_DIR="${FLEET_CHART_DIR:-}"

function _require_cmd()
{
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[local] Missing required command: $cmd"
    exit 1
  fi
}

function _require_docker_healthy()
{
  if ! docker info >/dev/null 2>&1; then
    echo "[local] Docker daemon is not reachable. Start Colima/Docker and retry."
    exit 1
  fi
}

function _require_free_space()
{
  local free_kb
  local min_free_kb

  free_kb="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
  min_free_kb="$(( MIN_FREE_GB * 1024 * 1024 ))"

  if [[ -z "$free_kb" || "$free_kb" -lt "$min_free_kb" ]]; then
    echo "[local] Insufficient free disk space for image builds."
    echo "[local] Required: ${MIN_FREE_GB}GiB, Available: $(( free_kb / 1024 / 1024 ))GiB"
    exit 1
  fi
}

function _cleanup()
{
  if [[ "$KEEP_CLUSTER" == "1" ]]; then
    echo "[local] KEEP_CLUSTER=1, leaving k3d cluster '$CLUSTER_NAME' running"
    return
  fi

  echo "[local] Deleting k3d cluster '$CLUSTER_NAME'"
  k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
}

function _wait_for_rollout()
{
  local resource="$1"

  kubectl rollout status "$resource" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

function _wait_for_job()
{
  local job_name="$1"

  kubectl wait --for=condition=complete "job/$job_name" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

function _resolve_values_file()
{
  case "$LOCAL_PROFILE" in
    default)
      echo "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/values-k3d-local.yaml"
      ;;
    strict)
      echo "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/values-k3d-strict.yaml"
      ;;
    *)
      echo "[local] Unknown LOCAL_PROFILE: $LOCAL_PROFILE"
      echo "[local] Supported profiles: default, strict"
      exit 1
      ;;
  esac
}

trap _cleanup EXIT

VALUES_FILE="$(_resolve_values_file)"

# 1. Pre-flight — fail fast when required CLIs are missing.
_require_cmd docker
_require_cmd kubectl
_require_cmd helm
_require_cmd k3d
_require_docker_healthy
_require_free_space

if [[ -z "$FLEET_OPERATOR_DIR" || ! -f "$FLEET_OPERATOR_DIR/deploy/Dockerfile" || -z "$FLEET_CHART_DIR" || ! -d "$FLEET_CHART_DIR" ]]; then
  echo "[local] The fleet-operator app and fleet-platform chart moved to the WeOwnAI repo (elewa-git/opencrane#150) and no longer ship in this repo."
  echo "[local] Set FLEET_OPERATOR_DIR and FLEET_CHART_DIR to a checked-out copy of WeOwnAI's apps/fleet-operator and apps/fleet-platform, then re-run."
  exit 1
fi

# 2. Build local images so the cluster does not depend on published registries.
echo "[local] Building operator image"
docker build -f "$FLEET_OPERATOR_DIR/deploy/Dockerfile" -t opencrane/operator:local "$ROOT_DIR"

echo "[local] Building tenant image"
docker build -f "$ROOT_DIR/apps/feat-openclaw-tenant/deploy/Dockerfile" -t opencrane/tenant:local "$ROOT_DIR"

echo "[local] Building opencrane-ui image"
docker build -f "$ROOT_DIR/apps/opencrane/deploy/Dockerfile" -t opencrane/opencrane-server:local "$ROOT_DIR"

# 3. Create a fresh cluster for a deterministic full-stack install.
echo "[local] Recreating k3d cluster '$CLUSTER_NAME'"
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
k3d cluster create "$CLUSTER_NAME" --agents 1

# 4a. Pre-pulling the official CloudNativePG database image.
echo "[local] Pre-pulling official CloudNativePG database image"
docker pull ghcr.io/cloudnative-pg/postgresql:17.5
docker pull ghcr.io/cloudnative-pg/pgbouncer:1.25.1

# 4b. Import locally built images into the k3d runtime.
echo "[local] Importing images into k3d"
k3d image import opencrane/operator:local --cluster "$CLUSTER_NAME"
k3d image import opencrane/tenant:local --cluster "$CLUSTER_NAME"
k3d image import opencrane/opencrane-server:local --cluster "$CLUSTER_NAME"
k3d image import ghcr.io/cloudnative-pg/postgresql:17.5 --cluster "$CLUSTER_NAME"
k3d image import ghcr.io/cloudnative-pg/pgbouncer:1.25.1 --cluster "$CLUSTER_NAME"

echo "[local] Using profile '$LOCAL_PROFILE' with values '$VALUES_FILE'"

# 5. Install the pinned external CNPG test substrate, then one app-owned Cluster with
# isolated logical databases and credentials. Fleet and silo remain separate databases.
echo "[local] Installing CloudNativePG Engine Operator into control plane"
helm repo add cnpg https://cloudnative-pg.github.io/charts --force-update >/dev/null
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --version "$CNPG_CHART_VERSION" \
  --wait \
  --set-string monitoring.podMonitor.enabled=false

function _create_database_credentials()
{
  local credentials_secret="$1"
  local database_owner="$2"
  local database_password="$3"

  kubectl create secret generic "$credentials_secret" \
    -n "$NAMESPACE" \
    --type=kubernetes.io/basic-auth \
    --from-literal=username="$database_owner" \
    --from-literal=password="$database_password" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
}

echo "[local] Bootstrapping one credentials Secret per PostgreSQL authority"
_create_database_credentials "$POSTGRES_CREDENTIALS_SECRET" "$SILO_POSTGRES_OWNER" "$DB_PASSWORD"
_create_database_credentials "$FLEET_POSTGRES_CREDENTIALS_SECRET" "$FLEET_POSTGRES_OWNER" "$FLEET_DB_PASSWORD"
_create_database_credentials "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER" "$OBOT_DB_PASSWORD"
_create_database_credentials "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER" "$LITELLM_DB_PASSWORD"
_create_database_credentials "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_OWNER" "$LANGFUSE_DB_PASSWORD"
_create_database_credentials "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_NAME" "$POSTGRES_ADMIN_PASSWORD"
OPENCRANE_BASELINE_CONFIG_MAP="$(bash "$ROOT_DIR/apps/postgres/scripts/publish-initdb-baseline-config-map.sh" \
  "$NAMESPACE" \
  "$SILO_POSTGRES_OWNER" \
  "$ROOT_DIR/apps/opencrane/prisma/bootstrap/target-baseline.sql")"
OPENCRANE_BASELINE_SHA256="$(kubectl get configmap "$OPENCRANE_BASELINE_CONFIG_MAP" \
  -n "$NAMESPACE" \
  -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"

function _kubernetes_api_host_cidr()
{
  local address="$1"
  if [[ "$address" == *:* ]]; then
    printf '%s/128' "$address"
  else
    printf '%s/32' "$address"
  fi
}

KUBERNETES_API_SERVICE_IP="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.clusterIP}')"
KUBERNETES_API_SERVICE_PORT="$(kubectl get service kubernetes -n default -o jsonpath='{.spec.ports[0].port}')"
KUBERNETES_API_ENDPOINT_IP="$(kubectl get endpoints kubernetes -n default -o jsonpath='{.subsets[0].addresses[0].ip}')"
KUBERNETES_API_ENDPOINT_PORT="$(kubectl get endpoints kubernetes -n default -o jsonpath='{.subsets[0].ports[0].port}')"
POSTGRES_KUBERNETES_API_ARGS=(
  --set-string "networkPolicy.kubernetesApiServerCidrs[0]=$(_kubernetes_api_host_cidr "$KUBERNETES_API_SERVICE_IP")"
  --set "networkPolicy.kubernetesApiServerPort=$KUBERNETES_API_SERVICE_PORT"
  --set-string "networkPolicy.kubernetesApiServerEndpointCidrs[0]=$(_kubernetes_api_host_cidr "$KUBERNETES_API_ENDPOINT_IP")"
  --set "networkPolicy.kubernetesApiServerEndpointPort=$KUBERNETES_API_ENDPOINT_PORT")

function _install_postgres_server()
{
  local databases_json="[{\"name\":\"opencrane\",\"owner\":\"$SILO_POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"fleet\",\"owner\":\"$FLEET_POSTGRES_OWNER\",\"credentialsSecret\":\"$FLEET_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"langfuse\",\"owner\":\"$LANGFUSE_POSTGRES_OWNER\",\"credentialsSecret\":\"$LANGFUSE_POSTGRES_CREDENTIALS_SECRET\"}]"
  echo "[local] Installing one PostgreSQL server with isolated logical databases"
  helm upgrade --install "$POSTGRES_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    "${POSTGRES_KUBERNETES_API_ARGS[@]}" \
    --set-json "databases=$databases_json" \
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME" \
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$OPENCRANE_BASELINE_CONFIG_MAP" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql" \
    --set "storage.storageClass=local-path" \
    --set "networkPolicy.operatorNamespace=$NAMESPACE" \
    --set-json 'pooler.clientPodSelectors=[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"fleet-manager"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/name":"langfuse"}}]'
  kubectl wait --for=condition=Ready "cluster/$POSTGRES_RELEASE_NAME" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=create "deployment/${POSTGRES_RELEASE_NAME}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=condition=available "deployment/${POSTGRES_RELEASE_NAME}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  for database_resource in fleet obot litellm langfuse; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${POSTGRES_RELEASE_NAME}-${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  done
  kubectl wait --for=condition=complete "job/${POSTGRES_RELEASE_NAME}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

function _copy_cnpg_uri_secret()
{
  local source_secret="$1"
  local target_secret="$2"
  local target_key="$3"

  kubectl get secret "$source_secret" -n "$NAMESPACE" -o jsonpath='{.data.uri}' \
    | base64 -d \
    | kubectl create secret generic "$target_secret" -n "$NAMESPACE" \
        --from-file="${target_key}=/dev/stdin" --dry-run=client -o yaml \
    | kubectl apply -f -
}

_install_postgres_server
function _publish_database_connection()
{
  local credentials_secret="$1"
  local app_secret="$2"
  local database_name="$3"
  bash "$ROOT_DIR/apps/postgres/scripts/publish-app-connection-secret.sh" \
    "$NAMESPACE" "$credentials_secret" "$app_secret" "${POSTGRES_RELEASE_NAME}-pooler" "$database_name"
}

OPENCRANE_POSTGRES_APP_SECRET="${POSTGRES_RELEASE_NAME}-opencrane-app"
FLEET_POSTGRES_APP_SECRET="${POSTGRES_RELEASE_NAME}-fleet-app"
OBOT_POSTGRES_APP_SECRET="${POSTGRES_RELEASE_NAME}-obot-app"
LITELLM_POSTGRES_APP_SECRET="${POSTGRES_RELEASE_NAME}-litellm-app"
LANGFUSE_POSTGRES_APP_SECRET="${POSTGRES_RELEASE_NAME}-langfuse-app"
_publish_database_connection "$POSTGRES_CREDENTIALS_SECRET" "$OPENCRANE_POSTGRES_APP_SECRET" opencrane
_publish_database_connection "$FLEET_POSTGRES_CREDENTIALS_SECRET" "$FLEET_POSTGRES_APP_SECRET" fleet
_publish_database_connection "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_APP_SECRET" obot
_publish_database_connection "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_APP_SECRET" litellm
_publish_database_connection "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET" langfuse

function _assert_distinct_cnpg_app_credentials()
{
  local app_secrets=("$@")
  local i
  local j
  local left_username
  local left_password
  local right_username
  local right_password
  for ((i = 0; i < ${#app_secrets[@]}; i++)); do
    left_username="$(kubectl get secret "${app_secrets[$i]}" -n "$NAMESPACE" -o jsonpath='{.data.username}')"
    left_password="$(kubectl get secret "${app_secrets[$i]}" -n "$NAMESPACE" -o jsonpath='{.data.password}')"
    for ((j = i + 1; j < ${#app_secrets[@]}; j++)); do
      right_username="$(kubectl get secret "${app_secrets[$j]}" -n "$NAMESPACE" -o jsonpath='{.data.username}')"
      right_password="$(kubectl get secret "${app_secrets[$j]}" -n "$NAMESPACE" -o jsonpath='{.data.password}')"
      if [[ "$left_username" == "$right_username" || "$left_password" == "$right_password" ]]; then
        echo "[local] CNPG authorities '${app_secrets[$i]}' and '${app_secrets[$j]}' share generated credentials"
        exit 1
      fi
    done
  done
}
_assert_distinct_cnpg_app_credentials "$OPENCRANE_POSTGRES_APP_SECRET" "$FLEET_POSTGRES_APP_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET"

_copy_cnpg_uri_secret "$OBOT_POSTGRES_APP_SECRET" "${RELEASE_NAME}-obot" dsn
_copy_cnpg_uri_secret "$OBOT_POSTGRES_APP_SECRET" opencrane-silo-obot dsn
_copy_cnpg_uri_secret "$LITELLM_POSTGRES_APP_SECRET" opencrane-litellm-db DATABASE_URL

if [[ "$LOCAL_PROFILE" == "strict" ]]; then
  kubectl create secret generic "$LITELLM_SECRET_NAME" \
    -n "$NAMESPACE" \
    --from-literal=LITELLM_MASTER_KEY="$LITELLM_MASTER_KEY" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
fi

# 5b. Install cert-manager if enabled in the resolved values file to support in-cluster TLS certificate generation.
if grep -A 5 "certManager:" "$VALUES_FILE" 2>/dev/null | grep -q "enabled: true"; then
  echo "[local] Installing cert-manager"
  helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
  helm upgrade --install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --set crds.enabled=true \
    --wait
fi

# 6. Install the FLEET chart (fleet-manager + cluster bootstrap) wired to the in-cluster registry DB.
echo "[local] Installing fleet release '$RELEASE_NAME'"
helm_args=(
  upgrade
  --install
  "$RELEASE_NAME"
  "$FLEET_CHART_DIR"
  --namespace
  "$NAMESPACE"
  --create-namespace
  --values
  "$VALUES_FILE"
  --set
  "fleetManager.database.existingSecret=${FLEET_POSTGRES_APP_SECRET}"
  --set
  "fleetManager.database.secretKey=uri"
  --set
  "fleetManager.clusterTenantApi.enabled=false"
  --set
  "litellm.existingDatabaseSecret=opencrane-litellm-db"
  --set
  "litellm.databaseSecretKey=DATABASE_URL"
)

if [[ "$LOCAL_PROFILE" == "strict" ]]; then
  helm_args+=(--set "litellm.existingSecret=$LITELLM_SECRET_NAME")
else
  helm_args+=(--set-string "litellm.masterKey=$LITELLM_MASTER_KEY")
fi

# Per-cluster platform-operator seed (optional). Passed to Helm only when non-empty,
# so a default local install grants operator to nobody (fail-closed). Set via the
# OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL env (e.g. from the wizard).
if [[ -n "${OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL:-}" ]]; then
  helm_args+=(--set-string "fleetManager.oidc.platformOperatorSeedEmail=${OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL}")
  echo "[local] Seeding platform operator (verified OIDC email match) for this cluster"
fi

helm "${helm_args[@]}"

# 6b. Install the SILO chart into the same local test namespace.
echo "[local] Installing silo release 'opencrane-silo'"
silo_args=(
  upgrade
  --install
  opencrane-silo
  "$ROOT_DIR/apps/_infra/deploy-k8s"
  --namespace
  "$NAMESPACE"
  --values
  "$VALUES_FILE"
  --set
  "clustertenantManager.database.existingSecret=${OPENCRANE_POSTGRES_APP_SECRET}"
  --set
  "clustertenantManager.database.secretKey=uri"
  --set
  "litellm.existingDatabaseSecret=opencrane-litellm-db"
  --set
  "litellm.databaseSecretKey=DATABASE_URL"
)
if [[ "$LOCAL_PROFILE" == "strict" ]]; then
  silo_args+=(--set "litellm.existingSecret=$LITELLM_SECRET_NAME")
else
  silo_args+=(--set-string "litellm.masterKey=$LITELLM_MASTER_KEY")
fi
helm "${silo_args[@]}"

# 7. Wait for the platform workloads that depend on the database.
_wait_for_rollout "deployment/opencrane-fleet-manager"
_wait_for_rollout "deployment/opencrane-silo-opencrane-server"

if kubectl get deployment/opencrane-silo-litellm -n "$NAMESPACE" >/dev/null 2>&1; then
  _wait_for_rollout "deployment/opencrane-silo-litellm"
fi

echo "[local] PASS: local full-stack install succeeded"
echo "[local] Cluster: $CLUSTER_NAME"
echo "[local] Namespace: $NAMESPACE"
echo "[local] Control plane: http://localhost (expose with kubectl port-forward if needed)"
