#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Standalone-silo k3d e2e smoke test.
#
# Exercises the OpenCrane chart (apps/_infra/deploy-k8s) on its own. This test proves the
# local-control-plane story stands up unassisted:
#
#   1. install apps/_infra/deploy-k8s alone, standalone mode;
#   2. the operator self-seeds its own ClusterTenant CR on boot and binds it to
#      this namespace — `_SeedOwnClusterTenant`;
#   3. the test seeds one explicit, non-secret model fixture, then the operator seeds that
#      org's `<org>-default` workspace Tenant — `_SeedOwnDefaultTenant`;
#   4. the in-silo TenantOperator reconciles that Tenant CR into its openclaw
#      child resources and writes status back.
#
# The chart owns its own CRDs (crds.install) so a bare k3d cluster needs no
# pre-installed OpenCrane CRDs. cert-manager is disabled here (the CI cluster has
# no cert-manager controller); per-org domain provisioning is best-effort and
# fail-closes cleanly without cert-manager/external-dns, so manageOwnDomain stays
# on as in a real standalone install.
# ============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-opencrane-e2e}"
NAMESPACE="${NAMESPACE:-opencrane-system}"
# Single release now — the standalone silo IS the whole install (no fleet release
# beside it). Kept as "opencrane-silo" so the silo's fullname-prefixed resources
# stay <release>-<component> (nameOverride "opencrane" is a prefix of the release
# name, so opencrane.fullname == the release name).
RELEASE_NAME="${RELEASE_NAME:-opencrane-silo}"
RUNTIME_NAMESPACE="${RUNTIME_NAMESPACE:-${RELEASE_NAME}-runtime}"
ARTIFACT_NAMESPACE="${ARTIFACT_NAMESPACE:-${NAMESPACE}-artifacts}"
ARTIFACT_CATALOG_KEY_SECRET="${ARTIFACT_CATALOG_KEY_SECRET:-opencrane-artifact-catalog-keys}"
ARTIFACT_SERVICE_KEY_SECRET="${ARTIFACT_SERVICE_KEY_SECRET:-opencrane-artifact-service-keys}"
ARTIFACT_KEY_DIR=""
KEEP_CLUSTER="${KEEP_CLUSTER:-0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-240}"
DB_STORAGE_GB="${DB_STORAGE_GB:-20}"
DISK_HEADROOM_GB="${DISK_HEADROOM_GB:-2}"
MIN_FREE_GB="${MIN_FREE_GB:-$(( DB_STORAGE_GB + DISK_HEADROOM_GB ))}"
OPENCRANE_DB_RELEASE_NAME="${OPENCRANE_DB_RELEASE_NAME:-opencrane-postgres}"
POSTGRES_CREDENTIALS_SECRET="${POSTGRES_CREDENTIALS_SECRET:-opencrane-postgres-credentials}"
OBOT_POSTGRES_CREDENTIALS_SECRET="${OBOT_POSTGRES_CREDENTIALS_SECRET:-opencrane-obot-postgres-credentials}"
LITELLM_POSTGRES_CREDENTIALS_SECRET="${LITELLM_POSTGRES_CREDENTIALS_SECRET:-opencrane-litellm-postgres-credentials}"
LANGFUSE_POSTGRES_CREDENTIALS_SECRET="${LANGFUSE_POSTGRES_CREDENTIALS_SECRET:-opencrane-langfuse-postgres-credentials}"
POSTGRES_ADMIN_NAME="${POSTGRES_ADMIN_NAME:-opencrane_database_admin}"
POSTGRES_ADMIN_CREDENTIALS_SECRET="${POSTGRES_ADMIN_CREDENTIALS_SECRET:-opencrane-postgres-admin-credentials}"
ADMIN_DB_PASSWORD="${ADMIN_DB_PASSWORD:-opencrane-admin-e2e-password}"
POSTGRES_OWNER="${POSTGRES_OWNER:-opencrane_e2e}"
OBOT_POSTGRES_OWNER="${OBOT_POSTGRES_OWNER:-obot_e2e}"
LITELLM_POSTGRES_OWNER="${LITELLM_POSTGRES_OWNER:-litellm_e2e}"
LANGFUSE_POSTGRES_OWNER="${LANGFUSE_POSTGRES_OWNER:-langfuse_e2e}"
DB_PASSWORD="${DB_PASSWORD:-opencrane-e2e-password}"
OBOT_DB_PASSWORD="${OBOT_DB_PASSWORD:-obot-e2e-password}"
LITELLM_DB_PASSWORD="${LITELLM_DB_PASSWORD:-litellm-e2e-password}"
LANGFUSE_DB_PASSWORD="${LANGFUSE_DB_PASSWORD:-langfuse-e2e-password}"
CNPG_CHART_VERSION="${CNPG_CHART_VERSION:-0.29.0}"
CNPG_SYSTEM_NAMESPACE="cnpg-system"
CERT_MANAGER_CHART_VERSION="${CERT_MANAGER_CHART_VERSION:-v1.15.1}"
BARMAN_CLOUD_PLUGIN_VERSION="${BARMAN_CLOUD_PLUGIN_VERSION:-0.13.0}"
MINIO_IMAGE="${MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z}"
MINIO_CLIENT_IMAGE="${MINIO_CLIENT_IMAGE:-quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z}"
BACKUP_OBJECT_STORE_NAME="${BACKUP_OBJECT_STORE_NAME:-opencrane-backup-store}"
BACKUP_MINIO_NAME="${BACKUP_MINIO_NAME:-opencrane-backup-minio}"
BACKUP_NAME="${BACKUP_NAME:-opencrane-backup-smoke}"
RESTORE_DB_RELEASE_NAME="${RESTORE_DB_RELEASE_NAME:-opencrane-postgres-restored}"
BACKUP_MARKER="${BACKUP_MARKER:-opencrane-backup-restore-smoke-v1}"
OPENCRANE_INTERNAL_PORT="${OPENCRANE_INTERNAL_PORT:-8081}"
LITELLM_SERVICE_PORT="${LITELLM_SERVICE_PORT:-4000}"
APP_POOLER_CLIENT_SELECTORS_JSON='[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/name":"langfuse"}}]'
RESTORE_POOLER_CLIENT_SELECTORS_JSON='[{"matchLabels":{"app.kubernetes.io/component":"postgres-restore-smoke"}},{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}},{"matchLabels":{"app.kubernetes.io/component":"litellm"}},{"matchLabels":{"app.kubernetes.io/name":"langfuse"}}]'

# Standalone self-seed identity (#151 item 4). The operator creates + binds THIS
# ClusterTenant on boot, then seeds its `<org>-default` workspace Tenant.
ORG_NAME="${ORG_NAME:-e2e-org}"
ORG_DISPLAY_NAME="${ORG_DISPLAY_NAME:-E2E Org}"
OWNER_EMAIL="${OWNER_EMAIL:-e2e@example.com}"
ORG_TIER="${ORG_TIER:-shared}"
# The seeded workspace Tenant is `<org>-default` (see `_DEFAULT_TENANT_SUFFIX`).
TENANT_NAME="${ORG_NAME}-default"
# Serving host for a tenant WITH a clusterTenantRef is `<org>.<base>` (see
# `_ResolveOrgServingDomain`); ingress.domain is opencrane.local in the e2e values.
INGRESS_DOMAIN="${INGRESS_DOMAIN:-opencrane.local}"
EXPECTED_INGRESS_HOST="${ORG_NAME}.${INGRESS_DOMAIN}"

function _require_cmd()
{
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[e2e] Missing required command: $cmd"
    exit 1
  fi
}

function _require_docker_healthy()
{
  if ! docker info >/dev/null 2>&1; then
    echo "[e2e] Docker daemon is not reachable. Start Colima/Docker and retry."
    exit 1
  fi
}

# Retry a flaky network-bound command with linear backoff. The image builds and pulls
# below fetch base layers from Docker Hub, which intermittently times out or rate-limits
# on CI runners (e.g. `dial tcp …:443: i/o timeout` resolving node:22-bookworm-slim) and
# fails the whole job on a transient blip. A retry is safe: builds/pulls are idempotent and
# the layer cache lets a re-run resume where it left off.
function _retry()
{
  local attempts="$1"; shift
  local n=1
  until "$@"; do
    if [[ "$n" -ge "$attempts" ]]; then
      echo "[e2e] command failed after ${attempts} attempts: $*"
      return 1
    fi
    echo "[e2e] attempt ${n}/${attempts} failed; retrying in $(( n * 5 ))s: $*"
    sleep "$(( n * 5 ))"
    n=$(( n + 1 ))
  done
}

# k3d 5.x can report a successful import even when its shared tarball disappears before one
# containerd node opens it. Verify the canonical image reference on every workload node and retry
# the whole import; otherwise a later Job silently falls back to an unpublished registry tag.
function _import_k3d_image()
{
  local image="$1"
  local canonical="$image"
  local registry="${image%%/*}"
  local attempt
  local listing
  local node
  local nodes
  local missing

  if [[ "$image" != */* ]]; then
    canonical="docker.io/library/$image"
  elif [[ "$registry" != *.* && "$registry" != *:* && "$registry" != "localhost" ]]; then
    canonical="docker.io/$image"
  fi

  nodes="$(docker ps --filter "label=k3d.cluster=$CLUSTER_NAME" --filter "label=k3d.role=server" --format '{{.Names}}')"
  nodes="$nodes $(docker ps --filter "label=k3d.cluster=$CLUSTER_NAME" --filter "label=k3d.role=agent" --format '{{.Names}}')"
  if [[ -z "${nodes//[[:space:]]/}" ]]; then
    echo "[e2e] no k3d workload nodes found for cluster $CLUSTER_NAME"
    return 1
  fi

  for attempt in 1 2 3; do
    if ! k3d image import "$image" --cluster "$CLUSTER_NAME"; then
      echo "[e2e] k3d import command failed for $image on attempt $attempt/3"
    fi

    missing=0
    for node in $nodes; do
      if ! listing="$(docker exec "$node" ctr --namespace k8s.io images list --quiet)"; then
        listing=""
      fi
      if ! grep -Fxq "$canonical" <<<"$listing"; then
        echo "[e2e] $canonical is still absent from $node after import attempt $attempt/3"
        missing=1
      fi
    done
    if [[ "$missing" -eq 0 ]]; then
      return 0
    fi
    sleep "$(( attempt * 2 ))"
  done

  echo "[e2e] image import did not converge on every workload node: $canonical"
  return 1
}

function _require_free_space()
{
  local free_kb
  local min_free_kb

  free_kb="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
  min_free_kb="$(( MIN_FREE_GB * 1024 * 1024 ))"

  if [[ -z "$free_kb" || "$free_kb" -lt "$min_free_kb" ]]; then
    echo "[e2e] Insufficient free disk space for image builds."
    echo "[e2e] Baseline includes DB storage (${DB_STORAGE_GB}GiB) + headroom (${DISK_HEADROOM_GB}GiB)."
    echo "[e2e] Required: ${MIN_FREE_GB}GiB, Available: $(( free_kb / 1024 / 1024 ))GiB"
    exit 1
  fi
}

function _cleanup()
{
  local exit_code=$?
  local diagnostic_namespace

  if [[ -n "$ARTIFACT_KEY_DIR" ]]; then
    rm -rf "$ARTIFACT_KEY_DIR" 2>/dev/null || true
  fi

  # On a failed run, dump cluster diagnostics BEFORE the teardown deletes the (otherwise lost)
  # cluster — pod/job states, recent events, and each pod's describe + current/previous logs
  # across both containers. Without this a CI failure in the deploy phase is undebuggable.
  if [[ "$exit_code" -ne 0 ]]; then
    echo "[e2e] ===== FAILURE (exit $exit_code): cluster diagnostics ====="
    kubectl get pods,jobs -A -o wide 2>/dev/null || true
    echo "[e2e] --- cluster services / network policies ---"
    kubectl get svc,endpoints,endpointslices -A -o wide 2>/dev/null || true
    kubectl get networkpolicies -A -o wide 2>/dev/null || true
    echo "[e2e] --- clustertenants / tenants ---"
    kubectl get clustertenants,tenants -A 2>/dev/null || true
    echo "[e2e] --- recent events ---"
    kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -60 || true
    for diagnostic_namespace in "$NAMESPACE" "$ARTIFACT_NAMESPACE"; do
      for p in $(kubectl get pods -n "$diagnostic_namespace" -o name 2>/dev/null); do
        local log_tail=80
        if [[ "$p" == *"opencrane-server"* ]]; then
          log_tail=240
        fi
        echo "[e2e] ### describe $diagnostic_namespace/$p"
        kubectl describe "$p" -n "$diagnostic_namespace" 2>/dev/null | tail -30 || true
        echo "[e2e] ### logs $diagnostic_namespace/$p"
        kubectl logs "$p" -n "$diagnostic_namespace" --all-containers --tail="$log_tail" 2>/dev/null || true
        kubectl logs "$p" -n "$diagnostic_namespace" --all-containers --previous --tail="$log_tail" 2>/dev/null || true
      done
    done
    echo "[e2e] ===== end diagnostics ====="
  fi

  if [[ "$KEEP_CLUSTER" == "1" ]]; then
    echo "[e2e] KEEP_CLUSTER=1, leaving k3d cluster '$CLUSTER_NAME' running"
    return
  fi

  echo "[e2e] Deleting k3d cluster '$CLUSTER_NAME'"
  k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
}

# Poll until the operator has self-seeded its own ClusterTenant CR and bound it to this
# namespace (`status.boundNamespace`). This is the standalone-only step a fleet-manager
# would otherwise own; it must complete before the default-workspace seed can find an org.
function _wait_for_clustertenant_bound()
{
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))

  while [[ $(date +%s) -lt $deadline ]]; do
    local bound
    bound="$(kubectl get clustertenant "$ORG_NAME" -o jsonpath='{.status.boundNamespace}' 2>/dev/null || true)"
    if [[ "$bound" == "$NAMESPACE" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "[e2e] Timed out waiting for ClusterTenant '$ORG_NAME' to bind namespace '$NAMESPACE'"
  kubectl get clustertenant "$ORG_NAME" -o yaml 2>/dev/null || true
  return 1
}

# Poll until the seeded `<org>-default` Tenant reaches status.phase=Running. The Tenant CR
# is seeded asynchronously on boot (after the ClusterTenant binds and the test model is present), so
# this tolerates it not existing yet — jsonpath on an absent CR is empty and the loop retries.
function _wait_for_tenant_running()
{
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))

  while [[ $(date +%s) -lt $deadline ]]; do
    local phase
    phase="$(kubectl get tenant "$TENANT_NAME" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "$phase" == "Running" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "[e2e] Timed out waiting for Tenant '$TENANT_NAME' status.phase=Running"
  kubectl get tenant "$TENANT_NAME" -n "$NAMESPACE" -o yaml 2>/dev/null || true
  return 1
}

function _wait_for_backup_completed()
{
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))

  while [[ $(date +%s) -lt $deadline ]]; do
    local phase
    phase="$(kubectl get backup "$BACKUP_NAME" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    case "$(printf '%s' "$phase" | tr '[:upper:]' '[:lower:]')" in
      completed)
        return 0
        ;;
      failed|"terminal error")
        echo "[e2e] Backup '$BACKUP_NAME' entered terminal phase '$phase'"
        kubectl describe backup "$BACKUP_NAME" -n "$NAMESPACE" 2>/dev/null || true
        return 1
        ;;
    esac
    sleep 2
  done

  echo "[e2e] Timed out waiting for Backup '$BACKUP_NAME' to complete"
  kubectl get backup "$BACKUP_NAME" -n "$NAMESPACE" -o yaml 2>/dev/null || true
  return 1
}

trap _cleanup EXIT

# 1. Pre-flight — fail fast when required CLIs are missing.
_require_cmd docker
_require_cmd kubectl
_require_cmd helm
_require_cmd k3d
_require_cmd openssl
if [[ "$ARTIFACT_NAMESPACE" == "$NAMESPACE" ]]; then
  echo "[e2e] ARTIFACT_NAMESPACE must differ from NAMESPACE so private key authorities stay isolated."
  exit 1
fi
_require_docker_healthy
_require_free_space

# 2. Build local images so e2e does not depend on pre-published GHCR tags. Each build is
#    retried — the base-image pull from Docker Hub flakes intermittently on CI runners.
echo "[e2e] Building opencrane-server (silo) image"
_retry 3 docker build -f "$ROOT_DIR/apps/opencrane/deploy/Dockerfile" -t opencrane/opencrane-server:e2e "$ROOT_DIR"

echo "[e2e] Building tenant image"
_retry 3 docker build -f "$ROOT_DIR/apps/feat-openclaw-tenant/deploy/Dockerfile" -t opencrane/tenant:e2e "$ROOT_DIR"

echo "[e2e] Building channel-proxy image"
_retry 3 docker build -f "$ROOT_DIR/apps/channel-proxy/deploy/Dockerfile" -t opencrane/channel-proxy:e2e "$ROOT_DIR"

echo "[e2e] Building artifact-service image"
_retry 3 docker build -f "$ROOT_DIR/apps/artifact-service/deploy/Dockerfile" -t opencrane/artifact-service:e2e "$ROOT_DIR"

# 3. Create a fresh cluster for deterministic test runs.
echo "[e2e] Recreating k3d cluster '$CLUSTER_NAME'"
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
k3d cluster create "$CLUSTER_NAME" --agents 1

# 4a. Pre-pulling the official CloudNativePG database image (retried — registry pulls flake).
echo "[e2e] Pre-pulling official CloudNativePG database image"
_retry 3 docker pull ghcr.io/cloudnative-pg/postgresql:17.5
_retry 3 docker pull ghcr.io/cloudnative-pg/pgbouncer:1.25.1
echo "[e2e] Pre-pulling pinned backup smoke images"
_retry 3 docker pull "$MINIO_IMAGE"
_retry 3 docker pull "$MINIO_CLIENT_IMAGE"

# 4b. Import images into the k3d cluster runtime.
echo "[e2e] Importing images into k3d"
_import_k3d_image opencrane/opencrane-server:e2e
_import_k3d_image opencrane/tenant:e2e
_import_k3d_image opencrane/channel-proxy:e2e
_import_k3d_image opencrane/artifact-service:e2e
_import_k3d_image ghcr.io/cloudnative-pg/postgresql:17.5
_import_k3d_image ghcr.io/cloudnative-pg/pgbouncer:1.25.1
_import_k3d_image "$MINIO_IMAGE"
_import_k3d_image "$MINIO_CLIENT_IMAGE"

# 5. Install the pinned external CNPG test substrate. The Barman plugin must run in
# the same namespace as the CNPG operator and requires cert-manager for its mTLS
# certificates. These are test-only prerequisites; production keeps all three as BYO
# cluster substrate.
echo "[e2e] Installing cert-manager for the CNPG-I backup plugin"
helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version "$CERT_MANAGER_CHART_VERSION" \
  --wait \
  --set crds.enabled=true

echo "[e2e] Installing CloudNativePG Engine Operator into control plane"
helm repo add cnpg https://cloudnative-pg.github.io/charts --force-update >/dev/null
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace "$CNPG_SYSTEM_NAMESPACE" \
  --create-namespace \
  --version "$CNPG_CHART_VERSION" \
  --wait \
  --set-string monitoring.podMonitor.enabled=false

echo "[e2e] Installing pinned Barman Cloud CNPG-I plugin"
kubectl apply -f "https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v${BARMAN_CLOUD_PLUGIN_VERSION}/manifest.yaml"
kubectl wait --for=condition=Established crd/objectstores.barmancloud.cnpg.io --timeout="${TIMEOUT_SECONDS}s"
kubectl rollout status deployment/barman-cloud \
  -n "$CNPG_SYSTEM_NAMESPACE" \
  --timeout="${TIMEOUT_SECONDS}s"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

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

echo "[e2e] Bootstrapping one credentials Secret per PostgreSQL authority"
# The non-superuser operational administrator has its own Secret, distinct from every database owner —
# the postgres chart requires databaseAdmin.{name,credentialsSecret} and never generates them.
_create_database_credentials "$POSTGRES_ADMIN_CREDENTIALS_SECRET" "$POSTGRES_ADMIN_NAME" "$ADMIN_DB_PASSWORD"
_create_database_credentials "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_OWNER" "$DB_PASSWORD"
_create_database_credentials "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER" "$OBOT_DB_PASSWORD"
_create_database_credentials "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER" "$LITELLM_DB_PASSWORD"
_create_database_credentials "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_OWNER" "$LANGFUSE_DB_PASSWORD"
OPENCRANE_BASELINE_CONFIG_MAP="$(bash "$ROOT_DIR/apps/postgres/scripts/publish-initdb-baseline-config-map.sh" \
  "$NAMESPACE" \
  "$POSTGRES_OWNER" \
  "$ROOT_DIR/apps/opencrane/prisma/bootstrap/target-baseline.sql")"
OPENCRANE_BASELINE_SHA256="$(kubectl get configmap "$OPENCRANE_BASELINE_CONFIG_MAP" \
  -n "$NAMESPACE" \
  -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
DATABASES_JSON="[{\"name\":\"opencrane\",\"owner\":\"$POSTGRES_OWNER\",\"credentialsSecret\":\"$POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"obot\",\"owner\":\"$OBOT_POSTGRES_OWNER\",\"credentialsSecret\":\"$OBOT_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"litellm\",\"owner\":\"$LITELLM_POSTGRES_OWNER\",\"credentialsSecret\":\"$LITELLM_POSTGRES_CREDENTIALS_SECRET\"},{\"name\":\"langfuse\",\"owner\":\"$LANGFUSE_POSTGRES_OWNER\",\"credentialsSecret\":\"$LANGFUSE_POSTGRES_CREDENTIALS_SECRET\"}]"

echo "[e2e] Installing pinned MinIO backup target"
kubectl create secret generic opencrane-backup-object-store-credentials \
  -n "$NAMESPACE" \
  --from-literal=ACCESS_KEY_ID=opencrane-backup \
  --from-literal=ACCESS_SECRET_KEY=opencrane-backup-password \
  --dry-run=client \
  -o yaml | kubectl apply -f -

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${BACKUP_MINIO_NAME}
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${BACKUP_MINIO_NAME}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${BACKUP_MINIO_NAME}
    spec:
      containers:
        - name: minio
          image: ${MINIO_IMAGE}
          args: ["server", "/data"]
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: opencrane-backup-object-store-credentials
                  key: ACCESS_KEY_ID
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: opencrane-backup-object-store-credentials
                  key: ACCESS_SECRET_KEY
          ports:
            - name: s3
              containerPort: 9000
          readinessProbe:
            httpGet:
              path: /minio/health/ready
              port: s3
            periodSeconds: 2
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: ${BACKUP_MINIO_NAME}
  namespace: ${NAMESPACE}
spec:
  selector:
    app.kubernetes.io/name: ${BACKUP_MINIO_NAME}
  ports:
    - name: s3
      port: 9000
      targetPort: s3
EOF
kubectl rollout status "deployment/${BACKUP_MINIO_NAME}" \
  -n "$NAMESPACE" \
  --timeout="${TIMEOUT_SECONDS}s"

cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-backup-bucket
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: create-bucket
          image: ${MINIO_CLIENT_IMAGE}
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              mc alias set local http://${BACKUP_MINIO_NAME}:9000 "\$ACCESS_KEY_ID" "\$ACCESS_SECRET_KEY"
              mc mb --ignore-existing local/backups
          env:
            - name: ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: opencrane-backup-object-store-credentials
                  key: ACCESS_KEY_ID
            - name: ACCESS_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: opencrane-backup-object-store-credentials
                  key: ACCESS_SECRET_KEY
EOF
kubectl wait --for=condition=Complete job/opencrane-backup-bucket \
  -n "$NAMESPACE" \
  --timeout="${TIMEOUT_SECONDS}s"

cat <<EOF | kubectl apply -f -
apiVersion: barmancloud.cnpg.io/v1
kind: ObjectStore
metadata:
  name: ${BACKUP_OBJECT_STORE_NAME}
  namespace: ${NAMESPACE}
spec:
  configuration:
    destinationPath: s3://backups/
    endpointURL: http://${BACKUP_MINIO_NAME}.${NAMESPACE}.svc.cluster.local:9000
    s3Credentials:
      accessKeyId:
        name: opencrane-backup-object-store-credentials
        key: ACCESS_KEY_ID
      secretAccessKey:
        name: opencrane-backup-object-store-credentials
        key: ACCESS_SECRET_KEY
    wal:
      compression: gzip
  instanceSidecarConfiguration:
    env:
      - name: AWS_REQUEST_CHECKSUM_CALCULATION
        value: when_required
      - name: AWS_RESPONSE_CHECKSUM_VALIDATION
        value: when_required
EOF

function _validate_cnpg_backup_recovery_schema()
{
  local rendered
  rendered="$(mktemp)"

  echo "[e2e] Validating backup contract against the pinned CNPG API server schema"
  helm template postgres-backup-contract "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    "${POSTGRES_KUBERNETES_API_ARGS[@]}" \
    --set-json "databases=$DATABASES_JSON" \
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME" \
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$OPENCRANE_BASELINE_CONFIG_MAP" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set backup.enabled=true \
    --set backup.plugin.name=barman-cloud.cloudnative-pg.io \
    --set backup.plugin.parameters.barmanObjectName=contract-only >"$rendered"
  kubectl apply --server-side --dry-run=server -n "$NAMESPACE" -f "$rendered" >/dev/null

  echo "[e2e] Validating recovery contract against the pinned CNPG API server schema"
  helm template postgres-recovery-contract "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    "${POSTGRES_KUBERNETES_API_ARGS[@]}" \
    --set-json "databases=$DATABASES_JSON" \
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME" \
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set restore.enabled=true \
    --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
    --set restore.plugin.parameters.barmanObjectName=contract-only \
    --set-string restore.targetTime=2026-07-18T00:00:00Z >"$rendered"
  kubectl apply --server-side --dry-run=server -n "$NAMESPACE" -f "$rendered" >/dev/null
  rm -f "$rendered"
}

function _install_postgres_server()
{
  echo "[e2e] Installing one PostgreSQL server with isolated logical databases"
  helm upgrade --install "$OPENCRANE_DB_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    "${POSTGRES_KUBERNETES_API_ARGS[@]}" \
    --set-json "databases=$DATABASES_JSON" \
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME" \
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name=$OPENCRANE_BASELINE_CONFIG_MAP" \
    --set-string "bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql" \
    --set "storage.size=${DB_STORAGE_GB}Gi" \
    --set "storage.storageClass=local-path" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set-json "pooler.clientPodSelectors=$APP_POOLER_CLIENT_SELECTORS_JSON"
  kubectl wait --for=condition=Ready "cluster/$OPENCRANE_DB_RELEASE_NAME" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=create "deployment/${OPENCRANE_DB_RELEASE_NAME}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=condition=available "deployment/${OPENCRANE_DB_RELEASE_NAME}-pooler" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  for database_resource in obot litellm langfuse; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${OPENCRANE_DB_RELEASE_NAME}-${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  done
  kubectl wait --for=condition=complete "job/${OPENCRANE_DB_RELEASE_NAME}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

function _publish_database_connection()
{
  local credentials_secret="$1"
  local app_secret="$2"
  local database_name="$3"
  bash "$ROOT_DIR/apps/postgres/scripts/publish-app-connection-secret.sh" \
    "$NAMESPACE" "$credentials_secret" "$app_secret" "${OPENCRANE_DB_RELEASE_NAME}-pooler" "$database_name"
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

# The first-workspace gate requires one registered model because tenant runtimes use LiteLLM in
# replace mode. Seed a deterministic model record for this disposable test only. The proxy route
# is registered and called after LiteLLM becomes ready, so this fixture cannot certify a merely
# database-shaped model. It contains no provider credential and no tenant receives an upstream
# provider secret.
function _seed_e2e_model_definition()
{
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-e2e-model-fixture
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: opencrane-server
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: seed-model
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO model_definitions (id, scope, public_model_name, litellm_model_id, upstream_model, is_default, created_at, updated_at) VALUES ('e2e-model-fixture', 'global', 'e2e/test-model', 'e2e-test-model', 'e2e/test-model', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${OPENCRANE_POSTGRES_APP_SECRET}
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-e2e-model-fixture -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

# Register the fixture in the live LiteLLM proxy and prove its mock-response path before accepting
# the seeded Tenant. LiteLLM's request-local mock response returns before any upstream provider
# call, letting the smoke prove the model route without a raw provider credential.
function _assert_e2e_model_routable()
{
  kubectl exec "deployment/${RELEASE_NAME}-litellm" -n "$NAMESPACE" -- python -c '
import json
import urllib.request

headers = {"Authorization": "Bearer e2e-master-key", "Content-Type": "application/json"}

def request(path, payload):
    body = json.dumps(payload).encode()
    command = urllib.request.Request("http://127.0.0.1:4000" + path, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(command, timeout=15) as response:
        return json.load(response)

request("/model/new", {"model_name": "e2e/test-model", "litellm_params": {"model": "openai/e2e-test-model"}})
completion = request("/v1/chat/completions", {"model": "e2e/test-model", "messages": [{"role": "user", "content": "fixture"}], "mock_response": "e2e model route"})
if completion["choices"][0]["message"]["content"] != "e2e model route":
    raise RuntimeError("LiteLLM fixture model did not return the expected mock response")
'
}

function _run_backup_restore_smoke()
{
  local baseline_mismatch_log
  baseline_mismatch_log="$(mktemp)"

  echo "[e2e] Enabling the pinned Barman plugin on '$OPENCRANE_DB_RELEASE_NAME'"
  helm upgrade "$OPENCRANE_DB_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    --reuse-values \
    --set backup.enabled=true \
    --set backup.plugin.name=barman-cloud.cloudnative-pg.io \
    --set-string "backup.plugin.parameters.barmanObjectName=$BACKUP_OBJECT_STORE_NAME"

  kubectl wait --for=condition=ContinuousArchiving "cluster/$OPENCRANE_DB_RELEASE_NAME" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"

  echo "[e2e] Writing marker before the physical base backup"
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-backup-marker-writer
  namespace: ${NAMESPACE}
spec:
  # The in-container SQL readiness loop owns the full bounded retry window.
  # Do not let Kubernetes multiply that window with replacement Pods.
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: opencrane-server
    spec:
      restartPolicy: Never
      containers:
        - name: writer
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              deadline="\$(( \$(date +%s) + ${TIMEOUT_SECONDS} ))"
              until psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1; do
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "[e2e] Timed out waiting for source PostgreSQL to accept SQL connections" >&2
                  exit 1
                fi
                sleep 2
              done
              psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
                "CREATE TABLE IF NOT EXISTS backup_restore_smoke (marker text PRIMARY KEY);"
              psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
                "INSERT INTO backup_restore_smoke(marker) VALUES ('${BACKUP_MARKER}') ON CONFLICT (marker) DO NOTHING;"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${OPENCRANE_POSTGRES_APP_SECRET}
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-backup-marker-writer \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"

  _write_logical_database_marker() {
    local database_name="$1"
    local app_secret="$2"
    local job_name="opencrane-backup-marker-writer-${database_name}"
    cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NAMESPACE}
spec:
  # The in-container SQL readiness loop owns the full bounded retry window.
  # Do not let Kubernetes multiply that window with replacement Pods.
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: mcp-gateway
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: writer
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              deadline="\$(( \$(date +%s) + ${TIMEOUT_SECONDS} ))"
              until psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1; do
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "[e2e] Timed out waiting for ${database_name} PostgreSQL to accept SQL connections" >&2
                  exit 1
                fi
                sleep 2
              done
              psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE IF NOT EXISTS backup_restore_smoke (marker text PRIMARY KEY);'
              psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO backup_restore_smoke(marker) VALUES ('${BACKUP_MARKER}-${database_name}') ON CONFLICT (marker) DO NOTHING;"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${app_secret}
                  key: uri
EOF
    kubectl wait --for=condition=Complete "job/${job_name}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  }

  _write_logical_database_marker obot "$OBOT_POSTGRES_APP_SECRET"
  _write_logical_database_marker litellm "$LITELLM_POSTGRES_APP_SECRET"
  _write_logical_database_marker langfuse "$LANGFUSE_POSTGRES_APP_SECRET"

  echo "[e2e] Taking an on-demand plugin backup"
  cat <<EOF | kubectl apply -f -
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: ${BACKUP_NAME}
  namespace: ${NAMESPACE}
spec:
  cluster:
    name: ${OPENCRANE_DB_RELEASE_NAME}
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
EOF
  _wait_for_backup_completed
  kubectl wait --for=condition=LastBackupSucceeded "cluster/$OPENCRANE_DB_RELEASE_NAME" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"

  echo "[e2e] Recovering the backup into fresh Cluster '$RESTORE_DB_RELEASE_NAME'"
  helm upgrade --install "$RESTORE_DB_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    "${POSTGRES_KUBERNETES_API_ARGS[@]}" \
    --set-json "databases=$DATABASES_JSON" \
    --set-string "databaseAdmin.name=$POSTGRES_ADMIN_NAME" \
    --set-string "databaseAdmin.credentialsSecret=$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256" \
    --set "storage.size=${DB_STORAGE_GB}Gi" \
    --set storage.storageClass=local-path \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set-json 'networkPolicy.clientPodSelectors=[{"matchLabels":{"app.kubernetes.io/component":"postgres-database-privileges"}}]' \
    --set-json "pooler.clientPodSelectors=$RESTORE_POOLER_CLIENT_SELECTORS_JSON" \
    --set restore.enabled=true \
    --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
    --set-string "restore.plugin.parameters.barmanObjectName=$BACKUP_OBJECT_STORE_NAME" \
    --set-string "restore.plugin.parameters.serverName=$OPENCRANE_DB_RELEASE_NAME"
  kubectl wait --for=condition=Ready "cluster/$RESTORE_DB_RELEASE_NAME" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=create "deployment/${RESTORE_DB_RELEASE_NAME}-pooler" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
  kubectl wait --for=condition=available "deployment/${RESTORE_DB_RELEASE_NAME}-pooler" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
  for database_resource in obot litellm langfuse; do
    kubectl wait --for=jsonpath='{.status.applied}'=true "database/${RESTORE_DB_RELEASE_NAME}-${database_resource}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  done
  kubectl wait --for=condition=complete "job/${RESTORE_DB_RELEASE_NAME}-database-privileges" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"

  echo "[e2e] Proving recovered baseline verification fails closed on a false claim"
  if helm upgrade "$RESTORE_DB_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    --reuse-values \
    --set-string bootstrap.targetBaseline.sha256=0000000000000000000000000000000000000000000000000000000000000000; then
    echo "[e2e] Recovered database accepted caller-asserted target-baseline provenance" >&2
    exit 1
  fi
  kubectl logs "job/${RESTORE_DB_RELEASE_NAME}-database-privileges" \
    -n "$NAMESPACE" \
    -c opencrane-privileges \
    >"$baseline_mismatch_log"
  grep -q "records baseline '$OPENCRANE_BASELINE_SHA256'" "$baseline_mismatch_log"
  helm upgrade "$RESTORE_DB_RELEASE_NAME" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    --reuse-values \
    --set-string "bootstrap.targetBaseline.sha256=$OPENCRANE_BASELINE_SHA256"
  rm -f "$baseline_mismatch_log"

  _publish_restored_connection() {
    local credentials_secret="$1"
    local app_secret="$2"
    local database_name="$3"
  bash "$ROOT_DIR/apps/postgres/scripts/publish-app-connection-secret.sh" \
      "$NAMESPACE" "$credentials_secret" "$app_secret" "${RESTORE_DB_RELEASE_NAME}-pooler" "$database_name"
  }
  _publish_restored_connection "$POSTGRES_CREDENTIALS_SECRET" "${RESTORE_DB_RELEASE_NAME}-opencrane-app" opencrane
  _publish_restored_connection "$OBOT_POSTGRES_CREDENTIALS_SECRET" "${RESTORE_DB_RELEASE_NAME}-obot-app" obot
  _publish_restored_connection "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "${RESTORE_DB_RELEASE_NAME}-litellm-app" litellm
  _publish_restored_connection "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "${RESTORE_DB_RELEASE_NAME}-langfuse-app" langfuse

  echo "[e2e] Verifying the restored marker through the recovered application Secret"
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-backup-restore-verifier
  namespace: ${NAMESPACE}
spec:
  # The in-container SQL readiness loop owns the full bounded retry window.
  # Do not let Kubernetes multiply that window with replacement Pods.
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: postgres-restore-smoke
    spec:
      restartPolicy: Never
      containers:
        - name: verifier
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              deadline="\$(( \$(date +%s) + ${TIMEOUT_SECONDS} ))"
              while true; do
                if restored_marker="\$(psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT marker FROM backup_restore_smoke WHERE marker = '${BACKUP_MARKER}'")"; then
                  break
                else
                  psql_status="\$?"
                fi
                # psql status 2 is a connection loss. SQL/schema failures use another status and
                # must fail immediately instead of being disguised as transient readiness.
                if [ "\$psql_status" -ne 2 ]; then
                  exit "\$psql_status"
                fi
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "[e2e] Timed out waiting for recovered PostgreSQL to accept SQL connections" >&2
                  exit 1
                fi
                sleep 2
              done
              test "\$restored_marker" = "${BACKUP_MARKER}"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${RESTORE_DB_RELEASE_NAME}-opencrane-app
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-backup-restore-verifier \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"

  _verify_restored_logical_marker() {
    local database_name="$1"
    local app_secret="$2"
    local job_name="opencrane-backup-restore-verifier-${database_name}"
    cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NAMESPACE}
spec:
  # The restored cluster may restart once while CNPG applies every logical database.
  # Keep that transient retry inside one bounded Pod instead of multiplying attempts.
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: postgres-restore-smoke
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: verifier
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              deadline="\$(( \$(date +%s) + ${TIMEOUT_SECONDS} ))"
              while true; do
                if restored_marker="\$(psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT marker FROM backup_restore_smoke WHERE marker = '${BACKUP_MARKER}-${database_name}'")"; then
                  break
                else
                  psql_status="\$?"
                fi
                # psql status 2 is a connection loss. SQL/schema failures use another status and
                # must fail immediately instead of being disguised as transient readiness.
                if [ "\$psql_status" -ne 2 ]; then
                  exit "\$psql_status"
                fi
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "[e2e] Timed out waiting for recovered ${database_name} PostgreSQL to accept SQL connections" >&2
                  exit 1
                fi
                sleep 2
              done
              test "\$restored_marker" = "${BACKUP_MARKER}-${database_name}"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${app_secret}
                  key: uri
EOF
    kubectl wait --for=condition=Complete "job/${job_name}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  }

  _verify_restored_logical_marker obot "${RESTORE_DB_RELEASE_NAME}-obot-app"
  _verify_restored_logical_marker litellm "${RESTORE_DB_RELEASE_NAME}-litellm-app"
  _verify_restored_logical_marker langfuse "${RESTORE_DB_RELEASE_NAME}-langfuse-app"
}

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

_validate_cnpg_backup_recovery_schema
_install_postgres_server
OPENCRANE_POSTGRES_APP_SECRET="${OPENCRANE_DB_RELEASE_NAME}-opencrane-app"
OBOT_POSTGRES_APP_SECRET="${OPENCRANE_DB_RELEASE_NAME}-obot-app"
LITELLM_POSTGRES_APP_SECRET="${OPENCRANE_DB_RELEASE_NAME}-litellm-app"
LANGFUSE_POSTGRES_APP_SECRET="${OPENCRANE_DB_RELEASE_NAME}-langfuse-app"
_publish_database_connection "$POSTGRES_CREDENTIALS_SECRET" "$OPENCRANE_POSTGRES_APP_SECRET" opencrane
_publish_database_connection "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_APP_SECRET" obot
_publish_database_connection "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_APP_SECRET" litellm
_publish_database_connection "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET" langfuse

function _assert_cross_database_denied()
{
  local source_name="$1"
  local source_secret="$2"
  local target_name="$3"
  local job_name="postgres-cross-db-${source_name}-${target_name}"

  echo "[e2e] Verifying $source_name cannot connect to $target_name"
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: mcp-gateway
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: cross-database-denial
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              # Wait until PostgreSQL accepts the source role before asserting isolation. The
              # managed-role reconcile that runs just after the cluster first reports Ready can
              # briefly bounce the primary; this Job has backoffLimit 0, so a single premature
              # attempt would hit "connection refused" and fail the whole check.
              deadline="\$(( \$(date +%s) + 120 ))"
              until psql -v ON_ERROR_STOP=1 -d "${source_name}" -c 'SELECT 1' >/dev/null 2>&1; do
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "timed out waiting for ${source_name} database connectivity" >&2
                  exit 1
                fi
                sleep 2
              done
              # The source role must NOT be able to reach the target database.
              if psql -v ON_ERROR_STOP=1 -d "${target_name}" -c 'SELECT 1' >/dev/null 2>&1; then
                echo "${source_name} unexpectedly connected to ${target_name}" >&2
                exit 1
              fi
          env:
            - name: PGHOST
              value: ${OPENCRANE_DB_RELEASE_NAME}-pooler
            - name: PGUSER
              valueFrom:
                secretKeyRef:
                  name: ${source_secret}
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${source_secret}
                  key: password
EOF
  kubectl wait --for=condition=complete "job/${job_name}" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
}

_assert_cross_database_denied obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" opencrane
_assert_cross_database_denied litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" obot
_assert_cross_database_denied langfuse "$LANGFUSE_POSTGRES_CREDENTIALS_SECRET" litellm

_run_backup_restore_smoke

# The standalone product must boot from the recovered authority, not quietly fall back to the
# source cluster that supplied the backup. Rebind every application consumer to its restored
# connection Secret before asserting credentials and installing the silo release.
OPENCRANE_POSTGRES_APP_SECRET="${RESTORE_DB_RELEASE_NAME}-opencrane-app"
OBOT_POSTGRES_APP_SECRET="${RESTORE_DB_RELEASE_NAME}-obot-app"
LITELLM_POSTGRES_APP_SECRET="${RESTORE_DB_RELEASE_NAME}-litellm-app"
LANGFUSE_POSTGRES_APP_SECRET="${RESTORE_DB_RELEASE_NAME}-langfuse-app"

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
        echo "[e2e] CNPG authorities '${app_secrets[$i]}' and '${app_secrets[$j]}' share generated credentials"
        exit 1
      fi
    done
  done
}
_assert_distinct_cnpg_app_credentials "$OPENCRANE_POSTGRES_APP_SECRET" "$OBOT_POSTGRES_APP_SECRET" "$LITELLM_POSTGRES_APP_SECRET" "$LANGFUSE_POSTGRES_APP_SECRET"

_seed_e2e_model_definition

_copy_cnpg_uri_secret "$OBOT_POSTGRES_APP_SECRET" "${RELEASE_NAME}-obot" dsn
_copy_cnpg_uri_secret "$LITELLM_POSTGRES_APP_SECRET" opencrane-litellm-db DATABASE_URL

# ArtifactStore crosses a real namespace and key-authority boundary. Reproduce the deploy
# engine's two-key arrangement in the disposable cluster so the smoke exercises the same
# topology: OpenCrane signs leases and verifies receipts, while artifact-service verifies
# leases and signs receipts. Private keys never share a Secret or namespace.
function _create_artifact_keys()
{
  kubectl create namespace "$ARTIFACT_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  ARTIFACT_KEY_DIR="$(mktemp -d)"

  openssl genpkey -algorithm ED25519 -out "$ARTIFACT_KEY_DIR/lease-private.pem"
  openssl pkey -in "$ARTIFACT_KEY_DIR/lease-private.pem" -pubout -out "$ARTIFACT_KEY_DIR/lease-public.pem"
  openssl genpkey -algorithm ED25519 -out "$ARTIFACT_KEY_DIR/receipt-private.pem"
  openssl pkey -in "$ARTIFACT_KEY_DIR/receipt-private.pem" -pubout -out "$ARTIFACT_KEY_DIR/receipt-public.pem"

  kubectl create secret generic "$ARTIFACT_CATALOG_KEY_SECRET" \
    -n "$NAMESPACE" \
    --from-file=lease-private.pem="$ARTIFACT_KEY_DIR/lease-private.pem" \
    --from-file=receipt-public.pem="$ARTIFACT_KEY_DIR/receipt-public.pem" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
  kubectl create secret generic "$ARTIFACT_SERVICE_KEY_SECRET" \
    -n "$ARTIFACT_NAMESPACE" \
    --from-file=lease-public.pem="$ARTIFACT_KEY_DIR/lease-public.pem" \
    --from-file=receipt-private.pem="$ARTIFACT_KEY_DIR/receipt-private.pem" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
}

_create_artifact_keys

# 6. Install ONLY the standalone silo chart, wired to the in-cluster database and images.
#    The test substrate has cert-manager for the CNPG-I plugin, but the OpenCrane release's
#    self-managed Issuer/Certificate stays disabled because this smoke has no routable domain.
#    Per-org domain provisioning stays on (manageOwnDomain, from standalone.yaml) and
#    fail-closes cleanly without external-dns.
echo "[e2e] Installing standalone silo release '$RELEASE_NAME'"
helm upgrade --install "$RELEASE_NAME" "$ROOT_DIR/apps/_infra/deploy-k8s" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/values/standalone.yaml" \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/values-k3d-e2e.yaml" \
  --set "clustertenantManager.standaloneSeed.name=$ORG_NAME" \
  --set "clustertenantManager.standaloneSeed.displayName=$ORG_DISPLAY_NAME" \
  --set "clustertenantManager.standaloneSeed.ownerEmail=$OWNER_EMAIL" \
  --set "clustertenantManager.standaloneSeed.tier=$ORG_TIER" \
  --set "clustertenantManager.database.existingSecret=${OPENCRANE_POSTGRES_APP_SECRET}" \
  --set "clustertenantManager.database.secretKey=uri" \
  --set "clustertenantManager.service.internalPort=$OPENCRANE_INTERNAL_PORT" \
  --set-string "networkPolicy.postgresPoolerName=${RESTORE_DB_RELEASE_NAME}-pooler" \
  --set "litellm.existingDatabaseSecret=opencrane-litellm-db" \
  --set "litellm.databaseSecretKey=DATABASE_URL" \
  --set "litellm.service.port=$LITELLM_SERVICE_PORT" \
  --set agentController.enabled=true \
  --set agentController.replicas=0 \
  --set-string agentController.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string agentController.runtimeProfile.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set-string "agentController.kubernetesApiServerCidrs[0]=$(_kubernetes_api_host_cidr "$KUBERNETES_API_SERVICE_IP")" \
  --set-string "agentController.kubernetesApiServerEndpointCidrs[0]=$(_kubernetes_api_host_cidr "$KUBERNETES_API_ENDPOINT_IP")" \
  --set "agentController.kubernetesApiServerEndpointPort=${KUBERNETES_API_ENDPOINT_PORT}" \
  --set-string "artifactService.namespace=$ARTIFACT_NAMESPACE" \
  --set-string "artifactService.keys.catalogExistingSecret=$ARTIFACT_CATALOG_KEY_SECRET" \
  --set-string "artifactService.keys.serviceExistingSecret=$ARTIFACT_SERVICE_KEY_SECRET" \
  --set "certManager.enabled=false"

# Wait for the opencrane-server (skip helm --wait because local-path PVCs don't bind until a pod
# mounts them, creating a chicken-and-egg with Helm's readiness checks). Resources are prefixed
# by the release name because nameOverride (opencrane) is a prefix of it, so
# opencrane.fullname == the release name → <release>-<component>.
kubectl rollout status "deployment/${RELEASE_NAME}-opencrane-server" -n "$NAMESPACE" --timeout=180s
kubectl rollout status "deployment/${RELEASE_NAME}-channel-proxy" -n "$NAMESPACE" --timeout=180s
kubectl rollout status "deployment/${RELEASE_NAME}-artifact-service" -n "$ARTIFACT_NAMESPACE" --timeout=180s

# The canonical bytes must live on their own mounted PVC behind the isolated Service and
# ingress/egress policy. These assertions keep the greenfield durability boundary in the smoke.
kubectl get pvc "${RELEASE_NAME}-artifact-service" -n "$ARTIFACT_NAMESPACE" >/dev/null
kubectl get service "${RELEASE_NAME}-artifact-service" -n "$ARTIFACT_NAMESPACE" >/dev/null
kubectl get networkpolicy "${RELEASE_NAME}-artifact-service" -n "$ARTIFACT_NAMESPACE" >/dev/null

# Durable command dispatch and the one-use bootstrap exchange are reached over egress only: the
# runtime plane must still declare NO ingress. Assert the agent-runtime NetworkPolicies carry an
# empty (or absent) ingress rule after this slice; any ingress rule would break the outbound-only
# posture the runtime namespace depends on.
RUNTIME_NP_INGRESS="$(kubectl get networkpolicy -n "$RUNTIME_NAMESPACE" -l app.kubernetes.io/component=agent-runtime -o jsonpath='{range .items[*]}{.spec.ingress}{end}' 2>/dev/null | tr -d '[:space:]')"
if [[ -n "${RUNTIME_NP_INGRESS//[]/}" ]]; then
  echo "[e2e] agent-runtime NetworkPolicy unexpectedly declares ingress: $RUNTIME_NP_INGRESS"
  exit 1
fi
echo "[e2e] PASS: agent-runtime network plane stays outbound-only after command dispatch"

# Execute both controller trust boundaries against the live API server. Replicas stay at zero so
# the probe owns every state transition: admission checks the exact Job shape, while a one-shot Job
# proves the projected controller token reaches server-side TokenReview through both policies.
bash "$ROOT_DIR/apps/agent-controller/tests/admission-conformance.sh" \
  "$NAMESPACE" \
  "$RUNTIME_NAMESPACE" \
  "$RELEASE_NAME" \
  "$OPENCRANE_INTERNAL_PORT" \
  "$LITELLM_SERVICE_PORT"
bash "$ROOT_DIR/apps/agent-controller/tests/identity-conformance.sh" "$NAMESPACE" "$RELEASE_NAME"

# Wait for LiteLLM (a silo plane) when cost routing is enabled by chart values.
if kubectl get "deployment/${RELEASE_NAME}-litellm" -n "$NAMESPACE" >/dev/null 2>&1; then
  kubectl rollout status "deployment/${RELEASE_NAME}-litellm" -n "$NAMESPACE" --timeout=240s
  _assert_e2e_model_routable
fi

# 7. Assert the standalone boot seeds ran: the operator created + bound its OWN ClusterTenant
#    (no fleet), then seeded the org's `<org>-default` workspace Tenant, which the in-silo
#    TenantOperator reconciles to Running.
echo "[e2e] Waiting for the self-seeded ClusterTenant '$ORG_NAME' to bind"
_wait_for_clustertenant_bound

echo "[e2e] Waiting for the seeded default Tenant '$TENANT_NAME' to reconcile"
_wait_for_tenant_running

# 8. Assert core reconciled resources exist. No per-user Ingress is asserted: the operator
#    retired per-user Ingresses — every user reaches the pod through the org host,
#    reverse-proxied to this pod's Service, so only the SA/ConfigMap/Deployment/Service/
#    encryption-key Secret are minted per tenant.
kubectl get serviceaccount "openclaw-${TENANT_NAME}" -n "$NAMESPACE" >/dev/null
kubectl get configmap "openclaw-${TENANT_NAME}-config" -n "$NAMESPACE" >/dev/null
kubectl get deployment "openclaw-${TENANT_NAME}" -n "$NAMESPACE" >/dev/null
kubectl get service "openclaw-${TENANT_NAME}" -n "$NAMESPACE" >/dev/null
kubectl get secret "openclaw-${TENANT_NAME}-encryption-key" -n "$NAMESPACE" >/dev/null

# 9. Assert status fields were written by the operator. This Tenant carries a
#    clusterTenantRef (its seeded org), so its serving host is the org apex
#    `<org>.<base>` (_ResolveOrgServingDomain). ingress.domain is opencrane.local in the
#    e2e values.
INGRESS_HOST="$(kubectl get tenant "$TENANT_NAME" -n "$NAMESPACE" -o jsonpath='{.status.ingressHost}')"
if [[ "$INGRESS_HOST" != "$EXPECTED_INGRESS_HOST" ]]; then
  echo "[e2e] Unexpected ingress host: $INGRESS_HOST (expected the org apex $EXPECTED_INGRESS_HOST)"
  exit 1
fi

echo "[e2e] PASS: standalone silo installs; operator self-seeds its ClusterTenant + default Tenant; TenantOperator reconciles it"
