#!/usr/bin/env bash
set -euo pipefail

# Blocking current-silo smoke for develop. This deliberately stays smaller than the retired
# backup/recovery qualification: it proves the checked-out app images, production deploy entrypoint,
# current umbrella chart, database authority boundary, TLS ingress, and every enabled Deployment.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-opencrane-develop-smoke}"
NAMESPACE="${NAMESPACE:-opencrane-develop-smoke}"
RELEASE_NAME="${RELEASE_NAME:-opencrane}"
ARTIFACT_NAMESPACE="${RELEASE_NAME}-artifacts"
BASE_DOMAIN="${BASE_DOMAIN:-develop-smoke.opencrane.test}"
CLUSTER_TENANT="${CLUSTER_TENANT:-smoke}"
CONTROL_PLANE_HOST="${CLUSTER_TENANT}.${BASE_DOMAIN}"
KEEP_CLUSTER="${KEEP_CLUSTER:-0}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.30.10-k3s1}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.15.1}"
CNPG_CHART_VERSION="${CNPG_CHART_VERSION:-0.29.0}"
KEY_DIR=""
CSI_DIR=""

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
  local pod
  while IFS= read -r pod; do
    [[ -z "$pod" ]] && continue
    echo "[develop-smoke] --- $NAMESPACE/$pod ---"
    kubectl describe "$pod" -n "$NAMESPACE" 2>/dev/null | tail -40 || true
    kubectl logs "$pod" -n "$NAMESPACE" --all-containers --tail=120 2>/dev/null || true
    kubectl logs "$pod" -n "$NAMESPACE" --all-containers --previous --tail=120 2>/dev/null || true
  done < <(kubectl get pods -n "$NAMESPACE" -o name 2>/dev/null || true)
  echo "[develop-smoke] ===== end diagnostics ====="
}

_cleanup()
{
  local exit_code=$?
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
    k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
  fi
  return "$exit_code"
}

_build_image()
{
  local image="$1"
  local dockerfile="$2"
  echo "[develop-smoke] Building $image"
  _retry 3 docker build --file "$ROOT_DIR/$dockerfile" --tag "$image" "$ROOT_DIR"
}

_import_image()
{
  local image="$1"
  echo "[develop-smoke] Importing $image"
  _retry 3 k3d image import "$image" --cluster "$CLUSTER_NAME"
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

_assert_ingress_health()
{
  local health_url="https://${CONTROL_PLANE_HOST}:8443/healthz"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  local response=""
  until response="$(curl --connect-timeout 2 --max-time 5 --fail --silent --show-error --insecure \
    --resolve "${CONTROL_PLANE_HOST}:8443:127.0.0.1" "$health_url" 2>/dev/null)" \
    && [[ "$response" == '{"status":"ok","db":true}' ]]; do
    if [[ $(date +%s) -ge "$deadline" ]]; then
      echo "[develop-smoke] Timed out waiting for database-backed health at $health_url; last response: $response" >&2
      return 1
    fi
    sleep 2
  done
}

trap _cleanup EXIT

for command in curl docker git helm k3d kubectl openssl; do _require_command "$command"; done
docker info >/dev/null 2>&1 || { echo "[develop-smoke] Docker daemon is not reachable." >&2; exit 1; }

_build_image opencrane/opencrane-server:develop-smoke apps/opencrane/deploy/Dockerfile
_build_image opencrane/opencrane-ui:develop-smoke apps/opencrane-ui/deploy/Dockerfile
_build_image opencrane/channel-proxy:develop-smoke apps/channel-proxy/deploy/Dockerfile
_build_image opencrane/memory-gateway:develop-smoke apps/memory-gateway/deploy/Dockerfile
_build_image opencrane/artifact-service:develop-smoke apps/artifact-service/deploy/Dockerfile

echo "[develop-smoke] Creating disposable k3d cluster '$CLUSTER_NAME'"
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true
k3d cluster create "$CLUSTER_NAME" --image "$K3S_IMAGE" --port "8443:443@loadbalancer" --wait

_import_image opencrane/opencrane-server:develop-smoke
_import_image opencrane/opencrane-ui:develop-smoke
_import_image opencrane/channel-proxy:develop-smoke
_import_image opencrane/memory-gateway:develop-smoke
_import_image opencrane/artifact-service:develop-smoke

echo "[develop-smoke] Installing external cluster prerequisites"
_install_expandable_test_storage
helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --version "$CERT_MANAGER_VERSION" \
  --wait --timeout "${TIMEOUT_SECONDS}s" --set crds.enabled=true
helm repo add cnpg https://cloudnative-pg.github.io/charts --force-update >/dev/null
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace --version "$CNPG_CHART_VERSION" \
  --wait --timeout "${TIMEOUT_SECONDS}s" --set-string monitoring.podMonitor.enabled=false

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
export TIMEOUT_SECONDS
"$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh" \
  --base-domain "$BASE_DOMAIN" \
  --cluster-tenant "$CLUSTER_TENANT" \
  --namespace "$NAMESPACE" \
  --release "$RELEASE_NAME" \
  --image-tag develop-smoke \
  --storage-class csi-hostpath-sc \
  --postgres-credentials-secret "$POSTGRES_CREDENTIALS_SECRET" \
  --obot-postgres-credentials-secret "$OBOT_POSTGRES_CREDENTIALS_SECRET" \
  --litellm-postgres-credentials-secret "$LITELLM_POSTGRES_CREDENTIALS_SECRET" \
  --postgres-admin-credentials-secret "$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
  --postgres-values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-postgres-values.yaml" \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml"

echo "[develop-smoke] Waiting for every enabled workload and certificate"
kubectl wait --for=condition=available deployment --all -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=available deployment --all -n "$ARTIFACT_NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=Ready certificate/opencrane-clustertenant-tls \
  -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"

_assert_database_isolation
_assert_ingress_health

echo "[develop-smoke] PASS: current silo, database isolation, TLS ingress, and all enabled workloads are healthy"
