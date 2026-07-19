#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Standalone-silo k3d e2e smoke test.
#
# Exercises the SILO chart (apps/_infra/deploy-k8s) on its own, in STANDALONE mode
# (deploymentMode=standalone) — no external fleet-manager anywhere. The fleet
# artifacts (apps/fleet-operator + apps/fleet-platform) moved to the WeOwnAI repo
# (italanta/opencrane#150) and no longer ship here, so the old fleet+silo
# integration test moved with them; the cross-plane "fleet provisions/manages a
# silo" assertions now live in WeOwnAI. This test proves opencrane's own
# standalone story stands up unassisted:
#
#   1. install apps/_infra/deploy-k8s alone, standalone mode;
#   2. the operator self-seeds its OWN ClusterTenant CR on boot and binds it to
#      this namespace (no fleet to do it) — `_SeedOwnClusterTenant`;
#   3. it then seeds that org's `<org>-default` workspace Tenant — the ≥1-model
#      onboarding gate is satisfied by the bootstrap provider key below, which
#      seeds a model at boot — `_SeedOwnDefaultTenant`;
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
KEEP_CLUSTER="${KEEP_CLUSTER:-0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-240}"
DB_STORAGE_GB="${DB_STORAGE_GB:-20}"
DISK_HEADROOM_GB="${DISK_HEADROOM_GB:-2}"
MIN_FREE_GB="${MIN_FREE_GB:-$(( DB_STORAGE_GB + DISK_HEADROOM_GB ))}"
OPENCRANE_DB_RELEASE_NAME="${OPENCRANE_DB_RELEASE_NAME:-opencrane-postgres}"
OBOT_DB_RELEASE_NAME="${OBOT_DB_RELEASE_NAME:-opencrane-obot-postgres}"
LITELLM_DB_RELEASE_NAME="${LITELLM_DB_RELEASE_NAME:-opencrane-litellm-postgres}"
POSTGRES_CREDENTIALS_SECRET="${POSTGRES_CREDENTIALS_SECRET:-opencrane-postgres-credentials}"
OBOT_POSTGRES_CREDENTIALS_SECRET="${OBOT_POSTGRES_CREDENTIALS_SECRET:-opencrane-obot-postgres-credentials}"
LITELLM_POSTGRES_CREDENTIALS_SECRET="${LITELLM_POSTGRES_CREDENTIALS_SECRET:-opencrane-litellm-postgres-credentials}"
POSTGRES_OWNER="${POSTGRES_OWNER:-opencrane_e2e}"
OBOT_POSTGRES_OWNER="${OBOT_POSTGRES_OWNER:-obot_e2e}"
LITELLM_POSTGRES_OWNER="${LITELLM_POSTGRES_OWNER:-litellm_e2e}"
DB_PASSWORD="${DB_PASSWORD:-opencrane-e2e-password}"
OBOT_DB_PASSWORD="${OBOT_DB_PASSWORD:-obot-e2e-password}"
LITELLM_DB_PASSWORD="${LITELLM_DB_PASSWORD:-litellm-e2e-password}"
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

# Boot-time BYOK bootstrap (apps/_infra/deploy-k8s `bootstrap.providerKey`): the
# operator provisions this OpenAI key on boot and SEEDS A MODEL, which satisfies
# the default-tenant seed's ≥1-model onboarding gate. The key never has to be
# valid — the model row is written locally regardless of whether LiteLLM/OpenAI
# are reachable, which is all the gate checks.
BOOTSTRAP_SECRET_NAME="${BOOTSTRAP_SECRET_NAME:-opencrane-bootstrap-provider-key}"
BOOTSTRAP_OPENAI_KEY="${BOOTSTRAP_OPENAI_KEY:-sk-e2e-dummy-key}"

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

  # On a failed run, dump cluster diagnostics BEFORE the teardown deletes the (otherwise lost)
  # cluster — pod/job states, recent events, and each pod's describe + current/previous logs
  # across both containers. Without this a CI failure in the deploy phase is undebuggable.
  if [[ "$exit_code" -ne 0 ]]; then
    echo "[e2e] ===== FAILURE (exit $exit_code): cluster diagnostics ====="
    kubectl get pods,jobs -n "$NAMESPACE" -o wide 2>/dev/null || true
    echo "[e2e] --- cluster services / network policies ---"
    kubectl get svc,endpoints,endpointslices -A -o wide 2>/dev/null || true
    kubectl get networkpolicies -A -o wide 2>/dev/null || true
    echo "[e2e] --- clustertenants / tenants ---"
    kubectl get clustertenants,tenants -A 2>/dev/null || true
    echo "[e2e] --- recent events ---"
    kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -40 || true
    for p in $(kubectl get pods -n "$NAMESPACE" -o name 2>/dev/null); do
      local log_tail=80
      if [[ "$p" == *"opencrane-server"* ]]; then
        log_tail=240
      fi
      echo "[e2e] ### describe $p"
      kubectl describe "$p" -n "$NAMESPACE" 2>/dev/null | tail -30 || true
      echo "[e2e] ### logs $p"
      kubectl logs "$p" -n "$NAMESPACE" --all-containers --tail="$log_tail" 2>/dev/null || true
      kubectl logs "$p" -n "$NAMESPACE" --all-containers --previous --tail="$log_tail" 2>/dev/null || true
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
# is seeded asynchronously on boot (after the ClusterTenant binds and a model is seeded), so
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
_require_docker_healthy
_require_free_space

# 2. Build local images so e2e does not depend on pre-published GHCR tags. Each build is
#    retried — the base-image pull from Docker Hub flakes intermittently on CI runners.
echo "[e2e] Building opencrane-server (silo) image"
_retry 3 docker build -f "$ROOT_DIR/apps/opencrane/deploy/Dockerfile" -t opencrane/opencrane-server:e2e "$ROOT_DIR"

echo "[e2e] Building tenant image"
_retry 3 docker build -f "$ROOT_DIR/apps/feat-openclaw-tenant/deploy/Dockerfile" -t opencrane/tenant:e2e "$ROOT_DIR"

# 3. Create a fresh cluster for deterministic test runs.
echo "[e2e] Recreating k3d cluster '$CLUSTER_NAME'"
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
k3d cluster create "$CLUSTER_NAME" --agents 1

# 4a. Pre-pulling the official CloudNativePG database image (retried — registry pulls flake).
echo "[e2e] Pre-pulling official CloudNativePG database image"
_retry 3 docker pull ghcr.io/cloudnative-pg/postgresql:17.5
echo "[e2e] Pre-pulling pinned backup smoke images"
_retry 3 docker pull "$MINIO_IMAGE"
_retry 3 docker pull "$MINIO_CLIENT_IMAGE"

# 4b. Import images into the k3d cluster runtime.
echo "[e2e] Importing images into k3d"
k3d image import opencrane/opencrane-server:e2e --cluster "$CLUSTER_NAME"
k3d image import opencrane/tenant:e2e --cluster "$CLUSTER_NAME"
k3d image import ghcr.io/cloudnative-pg/postgresql:17.5 --cluster "$CLUSTER_NAME"
k3d image import "$MINIO_IMAGE" --cluster "$CLUSTER_NAME"
k3d image import "$MINIO_CLIENT_IMAGE" --cluster "$CLUSTER_NAME"

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
_create_database_credentials "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_OWNER" "$DB_PASSWORD"
_create_database_credentials "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER" "$OBOT_DB_PASSWORD"
_create_database_credentials "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER" "$LITELLM_DB_PASSWORD"

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
    --set "credentials.existingSecret=$POSTGRES_CREDENTIALS_SECRET" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set backup.enabled=true \
    --set backup.plugin.name=barman-cloud.cloudnative-pg.io \
    --set backup.plugin.parameters.barmanObjectName=contract-only >"$rendered"
  kubectl apply --server-side --dry-run=server -n "$NAMESPACE" -f "$rendered" >/dev/null

  echo "[e2e] Validating recovery contract against the pinned CNPG API server schema"
  helm template postgres-recovery-contract "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    --set "credentials.existingSecret=$POSTGRES_CREDENTIALS_SECRET" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set restore.enabled=true \
    --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
    --set restore.plugin.parameters.barmanObjectName=contract-only \
    --set-string restore.targetTime=2026-07-18T00:00:00Z >"$rendered"
  kubectl apply --server-side --dry-run=server -n "$NAMESPACE" -f "$rendered" >/dev/null
  rm -f "$rendered"
}

function _install_database()
{
  local release_name="$1"
  local database_name="$2"
  local credentials_secret="$3"
  local database_owner="$4"
  local client_selectors_json="$5"

  echo "[e2e] Installing PostgreSQL target '$database_name' as '$release_name'"
  helm upgrade --install "$release_name" "$ROOT_DIR/apps/postgres/helm" \
    --namespace "$NAMESPACE" \
    --set "credentials.existingSecret=$credentials_secret" \
    --set-string "database.name=$database_name" \
    --set-string "database.owner=$database_owner" \
    --set "storage.size=${DB_STORAGE_GB}Gi" \
    --set "storage.storageClass=local-path" \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set-json "networkPolicy.clientPodSelectors=$client_selectors_json"
  kubectl wait --for=condition=Ready "cluster/$release_name" -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  bash "$ROOT_DIR/apps/postgres/scripts/publish-app-connection-secret.sh" \
    "$NAMESPACE" "$credentials_secret" "${release_name}-app" "${release_name}-rw" "$database_name"
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

function _migrate_opencrane_database()
{
  # A physical recovery must restore a bootable *fresh* application database, not
  # merely arbitrary PostgreSQL tables. Run the immutable application's normal
  # Prisma deploy before writing the backup marker so `_prisma_migrations` and the
  # target schema travel with the base backup. This is first-install bootstrap,
  # not compatibility or legacy-data migration.
  echo "[e2e] Initializing the fresh OpenCrane schema before physical backup"
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: opencrane-backup-schema-migrate
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/component: opencrane-server-migrate
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: db-migrate
          image: opencrane/opencrane-server:e2e
          imagePullPolicy: IfNotPresent
          command: ["node", "dist/apps/opencrane/scripts/migrate.js"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${OPENCRANE_DB_RELEASE_NAME}-app
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-backup-schema-migrate \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
}

function _run_backup_restore_smoke()
{
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
                  name: ${OPENCRANE_DB_RELEASE_NAME}-app
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-backup-marker-writer \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"

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
    --set "credentials.existingSecret=$POSTGRES_CREDENTIALS_SECRET" \
    --set-string database.name=opencrane \
    --set-string "database.owner=$POSTGRES_OWNER" \
    --set "storage.size=${DB_STORAGE_GB}Gi" \
    --set storage.storageClass=local-path \
    --set "networkPolicy.operatorNamespace=$CNPG_SYSTEM_NAMESPACE" \
    --set-json 'networkPolicy.clientPodSelectors=[{"matchLabels":{"app.kubernetes.io/component":"postgres-restore-smoke"}}]' \
    --set restore.enabled=true \
    --set restore.plugin.name=barman-cloud.cloudnative-pg.io \
    --set-string "restore.plugin.parameters.barmanObjectName=$BACKUP_OBJECT_STORE_NAME" \
    --set-string "restore.plugin.parameters.serverName=$OPENCRANE_DB_RELEASE_NAME"
  kubectl wait --for=condition=Ready "cluster/$RESTORE_DB_RELEASE_NAME" \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
  bash "$ROOT_DIR/apps/postgres/scripts/publish-app-connection-secret.sh" \
    "$NAMESPACE" "$POSTGRES_CREDENTIALS_SECRET" "${RESTORE_DB_RELEASE_NAME}-app" "${RESTORE_DB_RELEASE_NAME}-rw" opencrane

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
              until psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1; do
                if [ "\$(date +%s)" -ge "\$deadline" ]; then
                  echo "[e2e] Timed out waiting for recovered PostgreSQL to accept SQL connections" >&2
                  exit 1
                fi
                sleep 2
              done
              restored_marker="\$(psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT marker FROM backup_restore_smoke LIMIT 1')"
              test "\$restored_marker" = "${BACKUP_MARKER}"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${RESTORE_DB_RELEASE_NAME}-app
                  key: uri
EOF
  kubectl wait --for=condition=Complete job/opencrane-backup-restore-verifier \
    -n "$NAMESPACE" \
    --timeout="${TIMEOUT_SECONDS}s"
}

_validate_cnpg_backup_recovery_schema
_install_database "$OPENCRANE_DB_RELEASE_NAME" opencrane "$POSTGRES_CREDENTIALS_SECRET" "$POSTGRES_OWNER" \
  '[{"matchLabels":{"app.kubernetes.io/component":"opencrane-server"}},{"matchLabels":{"app.kubernetes.io/component":"opencrane-server-migrate"}}]'
_install_database "$OBOT_DB_RELEASE_NAME" obot "$OBOT_POSTGRES_CREDENTIALS_SECRET" "$OBOT_POSTGRES_OWNER" \
  '[{"matchLabels":{"app.kubernetes.io/component":"mcp-gateway"}}]'
_install_database "$LITELLM_DB_RELEASE_NAME" litellm "$LITELLM_POSTGRES_CREDENTIALS_SECRET" "$LITELLM_POSTGRES_OWNER" \
  '[{"matchLabels":{"app.kubernetes.io/component":"litellm"}}]'

_migrate_opencrane_database
_run_backup_restore_smoke

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
_assert_distinct_cnpg_app_credentials "${OPENCRANE_DB_RELEASE_NAME}-app" "${OBOT_DB_RELEASE_NAME}-app" "${LITELLM_DB_RELEASE_NAME}-app"

_copy_cnpg_uri_secret "${OBOT_DB_RELEASE_NAME}-app" "${RELEASE_NAME}-obot" dsn
_copy_cnpg_uri_secret "${LITELLM_DB_RELEASE_NAME}-app" opencrane-litellm-db DATABASE_URL

# Boot-time BYOK bootstrap key — seeds a model so the default-tenant seed's ≥1-model gate passes.
kubectl create secret generic "$BOOTSTRAP_SECRET_NAME" \
  -n "$NAMESPACE" \
  --from-literal=openaiApiKey="$BOOTSTRAP_OPENAI_KEY" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

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
  --set "deploymentMode=standalone" \
  --set "clustertenantManager.standaloneSeed.name=$ORG_NAME" \
  --set "clustertenantManager.standaloneSeed.displayName=$ORG_DISPLAY_NAME" \
  --set "clustertenantManager.standaloneSeed.ownerEmail=$OWNER_EMAIL" \
  --set "clustertenantManager.standaloneSeed.tier=$ORG_TIER" \
  --set "clustertenantManager.database.existingSecret=${OPENCRANE_DB_RELEASE_NAME}-app" \
  --set "clustertenantManager.database.secretKey=uri" \
  --set "litellm.existingDatabaseSecret=opencrane-litellm-db" \
  --set "litellm.databaseSecretKey=DATABASE_URL" \
  --set "bootstrap.providerKey.existingSecret=$BOOTSTRAP_SECRET_NAME" \
  --set "certManager.enabled=false"

# Wait for the opencrane-server (skip helm --wait because local-path PVCs don't bind until a pod
# mounts them, creating a chicken-and-egg with Helm's readiness checks). Resources are prefixed
# by the release name because nameOverride (opencrane) is a prefix of it, so
# opencrane.fullname == the release name → <release>-<component>.
kubectl rollout status "deployment/${RELEASE_NAME}-opencrane-server" -n "$NAMESPACE" --timeout=180s

# Wait for LiteLLM (a silo plane) when cost routing is enabled by chart values.
if kubectl get "deployment/${RELEASE_NAME}-litellm" -n "$NAMESPACE" >/dev/null 2>&1; then
  kubectl rollout status "deployment/${RELEASE_NAME}-litellm" -n "$NAMESPACE" --timeout=240s
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
