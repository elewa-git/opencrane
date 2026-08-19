#!/usr/bin/env bash
set -euo pipefail

# Blocking current-silo smoke for develop. This deliberately stays smaller than the retired
# backup/recovery qualification: it proves Nx-affected app images plus digest-validated baseline
# images, the production deploy entrypoint, database authority, TLS, and enabled Deployments.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-opencrane-develop-smoke}"
NAMESPACE="${NAMESPACE:-opencrane-develop-smoke}"
CLUSTER_TENANT="${CLUSTER_TENANT:-smoke}"
RELEASE_NAME="${RELEASE_NAME:-opencrane-${CLUSTER_TENANT}}"
ARTIFACT_NAMESPACE="${RELEASE_NAME}-artifacts"
BASE_DOMAIN="${BASE_DOMAIN:-develop-smoke.opencrane.test}"
CONTROL_PLANE_HOST="${CLUSTER_TENANT}.${BASE_DOMAIN}"
SMOKE_ACME_EMAIL="${SMOKE_ACME_EMAIL:-develop-smoke@opencrane.test}"
SMOKE_FIRST_USER_EMAIL="${SMOKE_FIRST_USER_EMAIL:-owner@develop-smoke.opencrane.test}"
KEEP_CLUSTER="${KEEP_CLUSTER:-0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.30.10-k3s1}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.15.1}"
CNPG_CHART_VERSION="${CNPG_CHART_VERSION:-0.29.0}"
SMOKE_AFFECTED_PROJECTS="${SMOKE_AFFECTED_PROJECTS-all}"
SMOKE_BASE_SHA="${SMOKE_BASE_SHA:-}"
SMOKE_REGISTRY="${SMOKE_REGISTRY:-ghcr.io/elewa-git}"
SMOKE_STORAGE_MODE="${SMOKE_STORAGE_MODE:-full}"
KEY_DIR=""
CSI_DIR=""
IMAGE_PREPARATION_PID=""
CERT_MANAGER_INSTALL_PID=""
SMOKE_IMAGES=(
  opencrane/opencrane-server:develop-smoke
  opencrane/opencrane-ui:develop-smoke
  opencrane/channel-proxy:develop-smoke
  opencrane/memory-gateway:develop-smoke
  opencrane/artifact-service:develop-smoke
  opencrane/cognee:develop-smoke
)

# Every image this script builds carries this label so teardown can prune exactly the run's
# images (current tags + layers orphaned by earlier runs) without touching anything else.
SMOKE_IMAGE_LABEL="opencrane.develop-smoke=true"

POSTGRES_CREDENTIALS_SECRET="develop-smoke-opencrane-postgres"
OBOT_POSTGRES_CREDENTIALS_SECRET="develop-smoke-obot-postgres"
LITELLM_POSTGRES_CREDENTIALS_SECRET="develop-smoke-litellm-postgres"
POSTGRES_ADMIN_CREDENTIALS_SECRET="develop-smoke-postgres-admin"

_require_command()
{
  command -v "$1" >/dev/null 2>&1 || { echo "[develop-smoke] Missing required command: $1" >&2; exit 1; }
}

_retry()
{
  local attempts="$1"
  shift
  local attempt=1
  until "$@"; do
    if [[ "$attempt" -ge "$attempts" ]]; then
      echo "[develop-smoke] Command failed after $attempts attempts: $*" >&2
      return 1
    fi
    echo "[develop-smoke] Attempt $attempt/$attempts failed; retrying: $*"
    sleep "$((attempt * 5))"
    attempt=$((attempt + 1))
  done
}

_diagnostics()
{
  echo "[develop-smoke] ===== failure diagnostics ====="
  kubectl get pods,jobs,deployments -A -o wide 2>/dev/null || true
  kubectl get clusters,databases,poolers -A 2>/dev/null || true
  kubectl get certificates,issuers -A 2>/dev/null || true
  kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -80 || true
  local diagnostic_namespace
  local pod
  for diagnostic_namespace in "$NAMESPACE" "$ARTIFACT_NAMESPACE"; do
    while IFS= read -r pod; do
      [[ -z "$pod" ]] && continue
      echo "[develop-smoke] --- $diagnostic_namespace/$pod ---"
      kubectl describe "$pod" -n "$diagnostic_namespace" 2>/dev/null | tail -40 || true
      kubectl logs "$pod" -n "$diagnostic_namespace" --all-containers --tail=120 2>/dev/null || true
      kubectl logs "$pod" -n "$diagnostic_namespace" --all-containers --previous --tail=120 2>/dev/null || true
    done < <(kubectl get pods -n "$diagnostic_namespace" -o name 2>/dev/null || true)
  done
  echo "[develop-smoke] ===== end diagnostics ====="
}

# Remove everything the run left in the Docker daemon: the cluster, any node containers a
# killed earlier run stranded, their named + anonymous volumes, and the label-scoped images.
# Without this, repeated smoke runs accumulate multi-GB writable layers and dangling image
# layers until the Docker VM disk fills.
_teardown_cluster_storage()
{
  local containers volumes volume
  containers="$(docker ps -aq --filter "name=^k3d-${CLUSTER_NAME}-" 2>/dev/null || true)"
  volumes=""
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    volumes="$(docker inspect --format \
      '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' \
      $containers 2>/dev/null || true)"
  fi
  k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    docker rm -f -v $containers >/dev/null 2>&1 || true
  fi
  while IFS= read -r volume; do
    [[ -z "$volume" ]] && continue
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done <<< "$volumes"
  while IFS= read -r volume; do
    [[ -z "$volume" ]] && continue
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done < <(docker volume ls -q --filter "name=k3d-${CLUSTER_NAME}" 2>/dev/null || true)
  docker image prune --all --force --filter "label=${SMOKE_IMAGE_LABEL}" >/dev/null 2>&1 || true
}

_cleanup()
{
  local exit_code=$?
  local background_pid
  for background_pid in "$IMAGE_PREPARATION_PID" "$CERT_MANAGER_INSTALL_PID"; do
    [[ -z "$background_pid" ]] && continue
    kill "$background_pid" >/dev/null 2>&1 || true
    wait "$background_pid" >/dev/null 2>&1 || true
  done
  IMAGE_PREPARATION_PID=""
  CERT_MANAGER_INSTALL_PID=""
  if [[ "$exit_code" -ne 0 ]]; then
    _diagnostics
  fi
  if [[ -n "$KEY_DIR" ]]; then
    rm -rf -- "$KEY_DIR"
  fi
  if [[ -n "$CSI_DIR" ]]; then
    rm -rf -- "$CSI_DIR"
  fi
  if [[ "$KEEP_CLUSTER" == "1" ]]; then
    echo "[develop-smoke] KEEP_CLUSTER=1; leaving '$CLUSTER_NAME' running"
  else
    _teardown_cluster_storage
  fi
  return "$exit_code"
}

_build_image()
{
  local project="$1"
  local image="$2"
  local dockerfile="$3"
  local cache_arguments=()
  # CI shares registry layer caches per deployable with the publish jobs (see BUILD_CACHE_IMAGE
  # in docker.yml). SMOKE_BUILD_CACHE is the trusted cache that integration pushes maintain;
  # SMOKE_BUILD_CACHE_UNTRUSTED adds the pull-request cache as a second read source; and
  # SMOKE_BUILD_CACHE_EXPORT names where this run may write its layers, so the next push builds
  # warm. Local runs leave all three unset and build without a remote cache.
  if [[ -n "${SMOKE_BUILD_CACHE:-}" ]]; then
    cache_arguments+=(--cache-from "type=registry,ref=${SMOKE_BUILD_CACHE}:${project}")
  fi
  if [[ -n "${SMOKE_BUILD_CACHE_UNTRUSTED:-}" ]]; then
    cache_arguments+=(--cache-from "type=registry,ref=${SMOKE_BUILD_CACHE_UNTRUSTED}:${project}")
  fi
  if [[ -n "${SMOKE_BUILD_CACHE_EXPORT:-}" ]]; then
    cache_arguments+=(--cache-to "type=registry,ref=${SMOKE_BUILD_CACHE_EXPORT}:${project},mode=max")
  fi
  echo "[develop-smoke] Building $image"
  _retry 3 docker buildx build --load --file "$ROOT_DIR/$dockerfile" --tag "$image" \
    --label "$SMOKE_IMAGE_LABEL" "${cache_arguments[@]}" "$ROOT_DIR"
}

_project_is_affected()
{
  local project="$1"
  [[ "$SMOKE_AFFECTED_PROJECTS" == "all" \
    || ",${SMOKE_AFFECTED_PROJECTS}," == *",${project},"* ]]
}

_pull_baseline_image()
{
  local image="$1"
  local local_image="$2"
  local remote_repository="${SMOKE_REGISTRY}/${image}"
  local remote_ref digest
  [[ "$SMOKE_BASE_SHA" =~ ^[0-9a-f]{7,40}$ ]] || return 1
  remote_ref="${remote_repository}:sha-${SMOKE_BASE_SHA}"
  digest="$(docker buildx imagetools inspect "$remote_ref" 2>/dev/null \
    | awk '$1 == "Digest:" { print $2; exit }')"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  echo "[develop-smoke] Reusing $image from validated base $SMOKE_BASE_SHA at $digest"
  _retry 3 docker pull "${remote_repository}@${digest}"
  docker tag "${remote_repository}@${digest}" "$local_image"
}

_prepare_image()
{
  local project="$1"
  local local_image="$2"
  local remote_image="$3"
  local dockerfile="$4"
  if _project_is_affected "$project"; then
    echo "[develop-smoke] Nx selected $project for rebuild"
    _build_image "$project" "$local_image" "$dockerfile"
  elif ! _pull_baseline_image "$remote_image" "$local_image"; then
    echo "[develop-smoke] No validated base image for $project; rebuilding safely"
    _build_image "$project" "$local_image" "$dockerfile"
  fi
}

_prepare_images()
{
  _prepare_image opencrane opencrane/opencrane-server:develop-smoke \
    opencrane-server apps/opencrane/deploy/Dockerfile
  _prepare_image opencrane-ui opencrane/opencrane-ui:develop-smoke \
    opencrane-ui apps/opencrane-ui/deploy/Dockerfile
  _prepare_image channel-proxy opencrane/channel-proxy:develop-smoke \
    opencrane-channel-proxy apps/channel-proxy/deploy/Dockerfile
  _prepare_image memory-gateway opencrane/memory-gateway:develop-smoke \
    opencrane-memory-gateway apps/memory-gateway/deploy/Dockerfile
  _prepare_image artifact-service opencrane/artifact-service:develop-smoke \
    opencrane-artifact-service apps/artifact-service/deploy/Dockerfile
  _prepare_image cognee opencrane/cognee:develop-smoke \
    opencrane-cognee apps/_infra/cognee/deploy/Dockerfile
}

_create_database_credentials()
{
  local secret_name="$1"
  local username="$2"
  local password="$3"
  kubectl create secret generic "$secret_name" \
    --namespace "$NAMESPACE" \
    --type kubernetes.io/basic-auth \
    --from-literal=username="$username" \
    --from-literal=password="$password" \
    --dry-run=client -o yaml | kubectl apply -f -
}

_random_secret()
{
  openssl rand -hex 16
}

_install_expandable_test_storage()
{
  # The upstream hostpath CSI driver is explicitly a CI test driver. Unlike k3d's local-path
  # provisioner, it includes the external resizer and actually implements volume expansion.
  local snapshotter_commit="0f215370c7ca3eeef4ab7028824d3bc66e1f63bd"
  local hostpath_commit="a785248f2709f55ed461e3da6c59d39152dace41"
  local snapshotter_root="https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/${snapshotter_commit}"

  echo "[develop-smoke] Installing the pinned expandable hostpath CSI test driver"
  kubectl apply -f "$snapshotter_root/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml"
  kubectl apply -f "$snapshotter_root/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml"
  kubectl apply -f "$snapshotter_root/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml"
  kubectl apply -f "$snapshotter_root/deploy/kubernetes/snapshot-controller/rbac-snapshot-controller.yaml"
  kubectl apply -f "$snapshotter_root/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml"

  CSI_DIR="$(mktemp -d)"
  git -C "$CSI_DIR" init --quiet
  git -C "$CSI_DIR" remote add origin https://github.com/kubernetes-csi/csi-driver-host-path.git
  _retry 3 git -C "$CSI_DIR" fetch --quiet --depth=1 origin "$hostpath_commit"
  git -C "$CSI_DIR" checkout --quiet FETCH_HEAD
  bash "$CSI_DIR/deploy/kubernetes-latest/deploy.sh"
  kubectl apply -f "$CSI_DIR/examples/csi-storageclass.yaml"
  kubectl rollout status deployment/snapshot-controller -n kube-system --timeout="${TIMEOUT_SECONDS}s"
  kubectl rollout status statefulset/csi-hostpathplugin --timeout="${TIMEOUT_SECONDS}s"
  if [[ "$(kubectl get storageclass csi-hostpath-sc -o jsonpath='{.allowVolumeExpansion}')" != "true" ]]; then
    echo "[develop-smoke] csi-hostpath-sc does not declare volume expansion" >&2
    return 1
  fi

  cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: develop-smoke-expansion
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: csi-hostpath-sc
  resources:
    requests:
      storage: 64Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: develop-smoke-expansion
spec:
  restartPolicy: Never
  containers:
    - name: mount
      image: registry.k8s.io/pause:3.10
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: develop-smoke-expansion
EOF
  kubectl wait --for=condition=Ready pod/develop-smoke-expansion --timeout="${TIMEOUT_SECONDS}s"
  kubectl patch pvc develop-smoke-expansion --type=merge \
    -p '{"spec":{"resources":{"requests":{"storage":"128Mi"}}}}'
  kubectl wait --for=jsonpath='{.status.capacity.storage}'=128Mi \
    pvc/develop-smoke-expansion --timeout="${TIMEOUT_SECONDS}s"
  kubectl delete pod/develop-smoke-expansion pvc/develop-smoke-expansion --wait=true
}

_select_fast_test_storage()
{
  # The fast tier proves a fresh deployment, not driver expansion. Its disposable StorageClass
  # declares the production preflight shape; the protected full tier above proves the driver
  # actually performs the expansion.
  kubectl patch storageclass local-path --type=merge -p '{"allowVolumeExpansion":true}' >/dev/null
  SMOKE_STORAGE_CLASS="local-path"
  echo "[develop-smoke] Fast storage mode uses k3d local-path without the expansion exercise"
}

_wait_for_job()
{
  local job_name="$1"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  while [[ $(date +%s) -lt "$deadline" ]]; do
    if [[ "$(kubectl get job "$job_name" -n "$NAMESPACE" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)" == "1" ]]; then
      return 0
    fi
    if [[ "$(kubectl get job "$job_name" -n "$NAMESPACE" -o jsonpath='{.status.failed}' 2>/dev/null || true)" == "1" ]]; then
      kubectl logs "job/$job_name" -n "$NAMESPACE" --all-containers 2>/dev/null || true
      return 1
    fi
    sleep 2
  done
  echo "[develop-smoke] Timed out waiting for job/$job_name" >&2
  return 1
}

_assert_database_isolation()
{
  local job_name="develop-smoke-database-isolation"
  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${job_name}
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  activeDeadlineSeconds: ${TIMEOUT_SECONDS}
  template:
    metadata:
      labels:
        app.kubernetes.io/component: mcp-gateway
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: database-isolation
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              until psql -v ON_ERROR_STOP=1 -d obot -c 'SELECT 1' >/dev/null 2>&1; do sleep 2; done
              if psql -v ON_ERROR_STOP=1 -d opencrane -c 'SELECT 1' >/dev/null 2>&1; then
                echo "Obot authority unexpectedly connected to the OpenCrane database" >&2
                exit 1
              fi
          env:
            - name: PGHOST
              value: ${RELEASE_NAME}-postgres-pooler
            - name: PGUSER
              valueFrom:
                secretKeyRef:
                  name: ${OBOT_POSTGRES_CREDENTIALS_SECRET}
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${OBOT_POSTGRES_CREDENTIALS_SECRET}
                  key: password
EOF
  _wait_for_job "$job_name"
}

# Proves the public health report is complete and every service the smoke can provision is
# healthy. Model routing is the one exception: CI holds no provider credentials, so LiteLLM
# serves an empty estate and the models probe reports unavailable. Seeding a placeholder key
# instead made the server fetch a BYOK Secret through the API server and exit fatally when that
# call failed, so the report is asserted as-is and models is allowed to be unavailable. Reporting
# an unconfigured estate as disabled rather than unavailable is tracked separately.
_assert_ingress_health()
{
  local health_url="https://${CONTROL_PLANE_HOST}:8443/healthz"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  local response=""
  until response="$(curl --connect-timeout 2 --max-time 5 --fail --silent --show-error --insecure \
    --resolve "${CONTROL_PLANE_HOST}:8443:127.0.0.1" "$health_url" 2>/dev/null)" \
    && jq -e '
      .ready == true
      and (.services | keys == ["api", "channels", "database", "files", "integrations", "memory", "models"])
      and ([.services | to_entries[] | select(.key != "models") | .value]
        | all(. == "available" or . == "disabled"))
      and (.services.models == "available" or .services.models == "unavailable")
      and (.status == "ok" or (.status == "degraded" and .services.models != "available"))
    ' >/dev/null <<<"$response"; do
    if [[ $(date +%s) -ge "$deadline" ]]; then
      echo "[develop-smoke] Timed out waiting for the complete public health report at $health_url; last response: $response" >&2
      return 1
    fi
    sleep 2
  done
}

trap _cleanup EXIT
# Bash skips the EXIT trap on untrapped fatal signals — an interrupted run would strand the
# k3d node containers and their multi-GB writable layers. Route the signals through exit.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in curl docker git helm k3d kubectl openssl; do _require_command "$command"; done
docker info >/dev/null 2>&1 || { echo "[develop-smoke] Docker daemon is not reachable." >&2; exit 1; }
if [[ "$SMOKE_STORAGE_MODE" != "fast" && "$SMOKE_STORAGE_MODE" != "full" ]]; then
  echo "[develop-smoke] SMOKE_STORAGE_MODE must be 'fast' or 'full', got '$SMOKE_STORAGE_MODE'." >&2
  exit 1
fi

# Image preparation is the longest independent lane. Start it before k3d so cluster creation and
# external-controller readiness consume the same wall-clock time without fanning out five builds
# against the runner's small Docker daemon.
_prepare_images &
IMAGE_PREPARATION_PID=$!

echo "[develop-smoke] Creating disposable k3d cluster '$CLUSTER_NAME'"
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
k3d cluster create "$CLUSTER_NAME" --image "$K3S_IMAGE" --port "8443:443@loadbalancer" --wait

echo "[develop-smoke] Installing external cluster prerequisites"
if [[ "$SMOKE_STORAGE_MODE" == "full" ]]; then
  _install_expandable_test_storage
  SMOKE_STORAGE_CLASS="csi-hostpath-sc"
else
  _select_fast_test_storage
fi
helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm repo add cnpg https://cloudnative-pg.github.io/charts --force-update >/dev/null
# These controllers own disjoint releases, namespaces, and API groups. Install them together only
# after both repository indexes are ready so concurrent Helm processes never mutate repo state.
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --version "$CERT_MANAGER_VERSION" \
  --wait --timeout "${TIMEOUT_SECONDS}s" --set crds.enabled=true &
CERT_MANAGER_INSTALL_PID=$!
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace --version "$CNPG_CHART_VERSION" \
  --wait --timeout "${TIMEOUT_SECONDS}s" --set-string monitoring.podMonitor.enabled=false
if ! wait "$CERT_MANAGER_INSTALL_PID"; then
  CERT_MANAGER_INSTALL_PID=""
  echo "[develop-smoke] cert-manager installation failed" >&2
  exit 1
fi
CERT_MANAGER_INSTALL_PID=""

if ! wait "$IMAGE_PREPARATION_PID"; then
  IMAGE_PREPARATION_PID=""
  echo "[develop-smoke] Image preparation failed" >&2
  exit 1
fi
IMAGE_PREPARATION_PID=""
echo "[develop-smoke] Importing the complete current-silo image set in one k3d transfer"
_retry 3 k3d image import "${SMOKE_IMAGES[@]}" --cluster "$CLUSTER_NAME" --mode direct

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "[develop-smoke] Creating isolated database and fleet-verification inputs"
_create_database_credentials "$POSTGRES_CREDENTIALS_SECRET" opencrane "$(_random_secret)"
_create_database_credentials "$OBOT_POSTGRES_CREDENTIALS_SECRET" obot "$(_random_secret)"
_create_database_credentials "$LITELLM_POSTGRES_CREDENTIALS_SECRET" litellm "$(_random_secret)"
_create_database_credentials "$POSTGRES_ADMIN_CREDENTIALS_SECRET" opencrane_database_admin "$(_random_secret)"

KEY_DIR="$(mktemp -d)"
openssl genpkey -algorithm ED25519 -out "$KEY_DIR/private-key.pem"
openssl pkey -in "$KEY_DIR/private-key.pem" -pubout -out "$KEY_DIR/public-key.pem"
kubectl create secret generic opencrane-fleet-membership-verification \
  --namespace "$NAMESPACE" \
  --from-file=public-key.pem="$KEY_DIR/public-key.pem" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[develop-smoke] Installing the current silo through its app-owned deploy entrypoint"
export OIDC_ISSUER_URL="https://issuer.opencrane.test"
export OIDC_CLIENT_ID="develop-smoke"
export OPENCRANE_OIDC_CLIENT_SECRET="$(_random_secret)"
export OPENCRANE_OIDC_SESSION_SECRET="$(_random_secret)"
# The disposable k3d image is imported by a local tag, not published to an OCI registry. The
# production deploy path still requires a UI digest; this explicit escape keeps the smoke honest.
export OPENCRANE_ALLOW_TAG_FLOAT=1
export TIMEOUT_SECONDS
# Exercise the production wrapper's required contact and first-owner inputs. The disposable `.test`
# host cannot complete public ACME, so the final --set flags deliberately restore its local issuer.
"$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh" \
  --base-domain "$BASE_DOMAIN" \
  --cluster-tenant "$CLUSTER_TENANT" \
  --acme-email "$SMOKE_ACME_EMAIL" \
  --first-user-email "$SMOKE_FIRST_USER_EMAIL" \
  --namespace "$NAMESPACE" \
  --release "$RELEASE_NAME" \
  --release-version "$(jq -r '.version' "$ROOT_DIR/package.json")" \
  --from-release-version fresh \
  --image-tag develop-smoke \
  --cognee-tag develop-smoke \
  --storage-class "$SMOKE_STORAGE_CLASS" \
  --postgres-credentials-secret "$POSTGRES_CREDENTIALS_SECRET" \
  --obot-postgres-credentials-secret "$OBOT_POSTGRES_CREDENTIALS_SECRET" \
  --litellm-postgres-credentials-secret "$LITELLM_POSTGRES_CREDENTIALS_SECRET" \
  --postgres-admin-credentials-secret "$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
  --postgres-values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-postgres-values.yaml" \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml" \
  --set "certManager.mode=selfSigned" \
  --set "certManager.issuerName=opencrane-develop-smoke-issuer"

echo "[develop-smoke] Waiting for every enabled workload and certificate"
kubectl wait --for=condition=available deployment --all -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=available deployment --all -n "$ARTIFACT_NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=Ready "certificate/${RELEASE_NAME}-clustertenant-tls" \
  -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"

_assert_database_isolation
_assert_ingress_health

echo "[develop-smoke] PASS: current silo, database isolation, TLS ingress, all enabled workloads, and $SMOKE_STORAGE_MODE storage qualification are healthy"
