#!/usr/bin/env bash
set -euo pipefail

# Blocking current-silo smoke for develop. This deliberately stays smaller than the retired
# backup/recovery qualification: it proves Nx-affected app images plus digest-validated baseline
# images, the production deploy entrypoint, database authority, TLS, and required service readiness.
# The disposable runc profile does not qualify gVisor isolation or an authenticated assistant turn.

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
SMOKE_INGRESS_PORT="${SMOKE_INGRESS_PORT:-8443}"
SMOKE_RESOURCE_OWNER="${SMOKE_RESOURCE_OWNER:-develop-smoke-$$}"
SMOKE_IMAGE_TAG="${SMOKE_RESOURCE_OWNER}-$$"
OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL="${OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL:-}"
SMOKE_LOCAL_REGISTRY_NAME="${CLUSTER_NAME}-registry"
SMOKE_LOCAL_REGISTRY_ADDRESS=""
SMOKE_CLUSTER_CREATED=0
SMOKE_REGISTRY_CREATED=0
SMOKE_REGISTRY_CONTAINER_ID=""
KEY_DIR=""
CSI_DIR=""
IMAGE_PREPARATION_PID=""
CERT_MANAGER_INSTALL_PID=""
SMOKE_IMAGES=(
  "opencrane/opencrane-server:${SMOKE_IMAGE_TAG}"
  "opencrane/opencrane-ui:${SMOKE_IMAGE_TAG}"
  "opencrane/memory-gateway:${SMOKE_IMAGE_TAG}"
  "opencrane/artifact-service:${SMOKE_IMAGE_TAG}"
  "opencrane/cognee:${SMOKE_IMAGE_TAG}"
)

# Each run gets its own tag and build label so parallel worktrees cannot replace one another's
# candidate image or prune a still-live smoke image from another invocation.
SMOKE_IMAGE_LABEL="opencrane.develop-smoke.run=${SMOKE_IMAGE_TAG}"
SMOKE_OWNER_IMAGE_LABEL="opencrane.develop-smoke.owner=${SMOKE_RESOURCE_OWNER}"

POSTGRES_CREDENTIALS_SECRET="develop-smoke-opencrane-postgres"
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
  kubectl get pods,jobs,deployments,statefulsets -A -o wide 2>/dev/null || true
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

# Refuse to replace a same-named resource unless its server label and registry network still match
# this invocation. The coordinator performs an earlier check, but the smoke repeats it next to the
# destructive command so a changed Docker object is not treated as the one that was reviewed.
_assert_owned_resource_set()
{
  local cluster_container="k3d-${CLUSTER_NAME}-server-0"
  local registry_container="k3d-${SMOKE_LOCAL_REGISTRY_NAME}"
  local current_owner=""
  local registry_networks=""
  local registry_id=""
  local cluster_exists=0
  local cluster_candidates=""
  local image_volume="k3d-${CLUSTER_NAME}-images"
  local candidate=""
  local candidate_name=""
  local candidate_owner=""
  local candidate_cluster=""
  local candidate_networks=""
  local image_volumes=""
  local labelled_volumes=""
  local server_volumes=""
  if docker inspect "$cluster_container" >/dev/null 2>&1; then
    cluster_exists=1
    current_owner="$(docker inspect --format '{{ index .Config.Labels "opencrane.tier3.owner" }}' "$cluster_container")"
    if [[ "$current_owner" != "$SMOKE_RESOURCE_OWNER" ]]; then
      echo "[develop-smoke] Refusing resource replacement: '$cluster_container' is owned by '${current_owner:-unknown}'." >&2
      return 1
    fi
  fi
  cluster_candidates="$(docker ps -aq --filter "label=k3d.cluster=${CLUSTER_NAME}")" || return 1
  image_volumes="$(docker volume ls -q)" || return 1
  labelled_volumes="$(docker volume ls -q --filter "label=k3d.cluster=${CLUSTER_NAME}")" || return 1

  if [[ "$cluster_exists" == "0" ]] \
    && { [[ -n "$cluster_candidates" ]] || [[ $'\n'"$image_volumes"$'\n' == *$'\n'"$image_volume"$'\n'* ]] || [[ -n "$labelled_volumes" ]]; }; then
    echo "[develop-smoke] Refusing replacement: '$CLUSTER_NAME' has unproved orphan nodes or image storage." >&2
    return 1
  fi
  for candidate in $cluster_candidates; do
    candidate_name="$(docker inspect --format '{{.Name}}' "$candidate")" || return 1
    candidate_owner="$(docker inspect --format '{{ index .Config.Labels "opencrane.tier3.owner" }}' "$candidate")" || return 1
    candidate_networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$candidate")" || return 1
    if [[ "$candidate_owner" != "$SMOKE_RESOURCE_OWNER" ]] \
      || [[ "$candidate_networks" != *"\"k3d-${CLUSTER_NAME}\""* ]] \
      || { [[ "$candidate_name" != "/k3d-${CLUSTER_NAME}-serverlb" ]] \
        && ! [[ "$candidate_name" =~ ^/k3d-${CLUSTER_NAME}-(server|agent)-[0-9]+$ ]]; }; then
      echo "[develop-smoke] Refusing unproved k3d cluster member '$candidate_name'." >&2
      return 1
    fi
  done
  cluster_candidates="$(docker ps -aq --filter "name=^k3d-${CLUSTER_NAME}-")" || return 1
  for candidate in $cluster_candidates; do
    candidate_name="$(docker inspect --format '{{.Name}}' "$candidate")" || return 1
    if [[ "$candidate_name" == "/k3d-${CLUSTER_NAME}-serverlb" ]] \
      || [[ "$candidate_name" =~ ^/k3d-${CLUSTER_NAME}-(server|agent)-[0-9]+$ ]]; then
      candidate_cluster="$(docker inspect --format '{{ index .Config.Labels "k3d.cluster" }}' "$candidate")" || return 1
      candidate_owner="$(docker inspect --format '{{ index .Config.Labels "opencrane.tier3.owner" }}' "$candidate")" || return 1
      if [[ "$cluster_exists" == "0" || "$candidate_cluster" != "$CLUSTER_NAME" || "$candidate_owner" != "$SMOKE_RESOURCE_OWNER" ]]; then
        echo "[develop-smoke] Refusing unproved same-name k3d node '$candidate_name'." >&2
        return 1
      fi
    fi
  done
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    if [[ "$cluster_exists" == "0" || "$candidate" != "$image_volume" ]]; then
      echo "[develop-smoke] Refusing unproved k3d volume '$candidate'." >&2
      return 1
    fi
  done <<< "$labelled_volumes"
  if [[ "$cluster_exists" == "1" && $'\n'"$image_volumes"$'\n' == *$'\n'"$image_volume"$'\n'* ]]; then
    if [[ $'\n'"$labelled_volumes"$'\n' != *$'\n'"$image_volume"$'\n'* ]]; then
      echo "[develop-smoke] Refusing image volume without the k3d cluster label." >&2
      return 1
    fi
    server_volumes="$(docker inspect --format '{{json .Mounts}}' "$cluster_container" | jq -r '.[] | select(.Type == "volume") | .Name')" || return 1
    if [[ $'\n'"$server_volumes"$'\n' != *$'\n'"$image_volume"$'\n'* ]]; then
      echo "[develop-smoke] Refusing image volume not mounted by the owner-labelled server." >&2
      return 1
    fi
  fi
  if docker inspect "$registry_container" >/dev/null 2>&1; then
    if [[ "$cluster_exists" == "0" && "$SMOKE_REGISTRY_CREATED" != "1" ]]; then
      echo "[develop-smoke] Refusing registry replacement without its owner-labelled cluster." >&2
      return 1
    fi
    if [[ "$SMOKE_REGISTRY_CREATED" == "1" ]]; then
      registry_id="$(docker inspect --format '{{.Id}}' "$registry_container")" || return 1
      if [[ "$registry_id" != "$SMOKE_REGISTRY_CONTAINER_ID" ]]; then
        echo "[develop-smoke] Refusing registry replacement after its Docker identity changed." >&2
        return 1
      fi
    fi
    registry_networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$registry_container")"
    if [[ "$cluster_exists" == "1" && "$registry_networks" != *"\"k3d-${CLUSTER_NAME}\""* ]]; then
      echo "[develop-smoke] Refusing registry replacement outside the owner-labelled cluster network." >&2
      return 1
    fi
  fi
}

# Delete the exact owner-labelled cluster and its associated registry. K3d removes its own node
# containers; direct prefix-based Docker removals would also catch another developer's resources.
# The image volume has one exact k3d name and each run's candidate images have a private label.
_prune_owned_smoke_images()
{
  local references reference repository tag suffix
  references="$(docker image ls --format '{{.Repository}}:{{.Tag}}')" || return 1
  while IFS= read -r reference; do
    [[ -z "$reference" ]] && continue
    repository="${reference%:*}"
    tag="${reference##*:}"
    [[ "$tag" == "${SMOKE_RESOURCE_OWNER}-"* ]] || continue
    suffix="${tag#"${SMOKE_RESOURCE_OWNER}-"}"
    [[ "$suffix" =~ ^[0-9]+$ ]] || continue
    case "$repository" in
      opencrane/opencrane-server|opencrane/opencrane-ui|opencrane/memory-gateway|opencrane/artifact-service|opencrane/cognee|opencrane/kurrentdb-bootstrap|opencrane/conversation-computer|127.0.0.1:*/opencrane-kurrentdb-bootstrap|127.0.0.1:*/opencrane-conversation-computer)
        docker image rm --no-prune "$reference" >/dev/null || return 1
        ;;
    esac
  done <<< "$references"
  docker image prune --all --force --filter "label=${SMOKE_OWNER_IMAGE_LABEL}" >/dev/null || return 1
}

_teardown_cluster_storage()
{
  _assert_owned_resource_set || return 1
  if docker inspect "k3d-${SMOKE_LOCAL_REGISTRY_NAME}" >/dev/null 2>&1; then
    _assert_owned_resource_set || return 1
    k3d registry delete "$SMOKE_LOCAL_REGISTRY_NAME" || return 1
  fi
  if docker inspect "k3d-${CLUSTER_NAME}-server-0" >/dev/null 2>&1; then
    _assert_owned_resource_set || return 1
    k3d cluster delete "$CLUSTER_NAME" || return 1
  fi
  _assert_owned_resource_set || return 1
  _prune_owned_smoke_images || return 1
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
  if [[ "$KEEP_CLUSTER" == "1" && "$SMOKE_CLUSTER_CREATED" == "1" ]]; then
    echo "[develop-smoke] KEEP_CLUSTER=1; leaving '$CLUSTER_NAME' running"
  else
    if ! _teardown_cluster_storage; then
      echo "[develop-smoke] Cleanup could not prove or remove this run's resources; unproved objects were left in place." >&2
      [[ "$exit_code" -ne 0 ]] || exit_code=1
    fi
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
  # in docker.yml). SMOKE_BUILD_CACHE is the cache that integration pushes maintain, and
  # SMOKE_BUILD_CACHE_EXPORT names where this run may write its layers, so the next push builds
  # warm. Pull requests read the cache but never export (the registry export costs 40-50 seconds
  # per image). Local runs leave both unset and build without a remote cache.
  if [[ -n "${SMOKE_BUILD_CACHE:-}" ]]; then
    cache_arguments+=(--cache-from "type=registry,ref=${SMOKE_BUILD_CACHE}:${project}")
  fi
  if [[ -n "${SMOKE_BUILD_CACHE_EXPORT:-}" ]]; then
    cache_arguments+=(--cache-to "type=registry,ref=${SMOKE_BUILD_CACHE_EXPORT}:${project},mode=max")
  fi
  echo "[develop-smoke] Building $image"
  _retry 3 docker buildx build --load --file "$ROOT_DIR/$dockerfile" --tag "$image" \
    --label "$SMOKE_IMAGE_LABEL" --label "$SMOKE_OWNER_IMAGE_LABEL" "${cache_arguments[@]}" "$ROOT_DIR"
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

# Each entry is project|local image|remote image|dockerfile for _prepare_image.
SMOKE_IMAGE_SPECS=(
  "opencrane|opencrane/opencrane-server:${SMOKE_IMAGE_TAG}|opencrane-server|apps/opencrane/deploy/Dockerfile"
  "opencrane-ui|opencrane/opencrane-ui:${SMOKE_IMAGE_TAG}|opencrane-ui|apps/opencrane-ui/deploy/Dockerfile"
  "memory-gateway|opencrane/memory-gateway:${SMOKE_IMAGE_TAG}|opencrane-memory-gateway|apps/memory-gateway/deploy/Dockerfile"
  "artifact-service|opencrane/artifact-service:${SMOKE_IMAGE_TAG}|opencrane-artifact-service|apps/artifact-service/deploy/Dockerfile"
  "cognee|opencrane/cognee:${SMOKE_IMAGE_TAG}|opencrane-cognee|apps/_infra/cognee/deploy/Dockerfile"
  "kurrentdb|opencrane/kurrentdb-bootstrap:${SMOKE_IMAGE_TAG}|opencrane-kurrentdb-bootstrap|apps/_infra/kurrentdb/deploy/Dockerfile"
  "conversation-computer|opencrane/conversation-computer:${SMOKE_IMAGE_TAG}|opencrane-conversation-computer|apps/conversation-computer/deploy/Dockerfile"
)

_prepare_images()
{
  # The preparations run concurrently: serially they dominated the smoke's wall clock
  # (~11 of 15 minutes) while each one mostly waits on registry and npm network I/O.
  # Every preparation logs to its own file so the concurrent output stays readable.
  local log_dir project local_image remote_image dockerfile
  local projects=() pids=() failed=0
  log_dir="$(mktemp -d)"
  for spec in "${SMOKE_IMAGE_SPECS[@]}"; do
    IFS='|' read -r project local_image remote_image dockerfile <<<"$spec"
    _prepare_image "$project" "$local_image" "$remote_image" "$dockerfile" \
      >"$log_dir/$project.log" 2>&1 &
    projects+=("$project")
    pids+=($!)
  done
  for index in "${!pids[@]}"; do
    if ! wait "${pids[$index]}"; then
      failed=1
      echo "[develop-smoke] Image preparation FAILED for ${projects[$index]}"
    fi
    cat "$log_dir/${projects[$index]}.log"
  done
  rm -rf -- "$log_dir"
  return "$failed"
}

# Only this disposable registry receives the two images whose charts require immutable digests.
# Hash its stored manifest bytes so the in-cluster repository names select exactly what we pushed.
_publish_smoke_image()
{
  local image="$1" repository="$2" digest
  local target="${SMOKE_LOCAL_REGISTRY_ADDRESS}/${repository}:${SMOKE_IMAGE_TAG}"
  docker tag "$image" "$target" || return 1
  _retry 3 docker push "$target" >&2 || return 1
  digest="$(curl --fail --silent --show-error \
    --header 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
    "http://${SMOKE_LOCAL_REGISTRY_ADDRESS}/v2/${repository}/manifests/${SMOKE_IMAGE_TAG}" \
    | openssl dgst -sha256 -r | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf 'sha256:%s\n' "$digest"
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

# Proves the retained LiteLLM owner cannot cross into OpenCrane's logical database.
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
        app.kubernetes.io/component: litellm
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      containers:
        - name: database-isolation
          image: ghcr.io/cloudnative-pg/postgresql:17.5
          command: ["/bin/sh", "-ceu"]
          args:
            - |
              until psql -v ON_ERROR_STOP=1 -d litellm -c 'SELECT 1' >/dev/null 2>&1; do sleep 2; done
              if psql -v ON_ERROR_STOP=1 -d opencrane -c 'SELECT 1' >/dev/null 2>&1; then
                echo "LiteLLM authority unexpectedly connected to the OpenCrane database" >&2
                exit 1
              fi
          env:
            - name: PGHOST
              value: ${RELEASE_NAME}-postgres-pooler
            - name: PGUSER
              valueFrom:
                secretKeyRef:
                  name: ${LITELLM_POSTGRES_CREDENTIALS_SECRET}
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${LITELLM_POSTGRES_CREDENTIALS_SECRET}
                  key: password
EOF
  _wait_for_job "$job_name"
}

# Proves the public health report is complete and every service the smoke can provision is
# healthy. Model routing is the one exception: CI holds no provider credentials, so LiteLLM serves
# an empty estate and the models probe reports unavailable. Provider setup now begins only through
# the authenticated durable command path, so a fresh server remains ready while that estate is
# intentionally empty. Reporting it as disabled rather than unavailable is tracked separately.
_assert_ingress_health()
{
  local health_url="https://${CONTROL_PLANE_HOST}:${SMOKE_INGRESS_PORT}/healthz"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  local response=""
  until response="$(curl --connect-timeout 2 --max-time 5 --fail --silent --show-error --insecure \
    --resolve "${CONTROL_PLANE_HOST}:${SMOKE_INGRESS_PORT}:127.0.0.1" "$health_url" 2>/dev/null)" \
    && jq -e '
      .ready == true
      and (.services | keys == ["api", "database", "files", "memory", "models"])
      and ([.services | to_entries[] | select(.key != "models") | .value]
        | all(. == "available"))
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

# A missing optional chart is not a successful current-silo install. Check the required resources
# explicitly, then exercise the real TLS and anonymous-read boundary from the admitted server Pod.
_assert_current_history_and_sandbox()
{
  kubectl rollout status "statefulset/${RELEASE_NAME}-kurrentdb" \
    -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
  _wait_for_job "${RELEASE_NAME}-kurrentdb-bootstrap"
  kubectl get "statefulset/${RELEASE_NAME}-kurrentdb" -n "$NAMESPACE" -o json | jq -e '
    .spec.template.spec.containers[] | select(.name == "kurrentdb")
    | ([.env[] | select(.name == "KURRENTDB_INSECURE"
        or .name == "KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS"
        or .name == "KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS") | .value]
      | length == 3 and all(. == "false"))
      and ([.readinessProbe, .livenessProbe]
        | all(.httpGet.path == "/health/live" and .httpGet.scheme == "HTTPS"
          and ((.httpGet.httpHeaders // []) | length == 0)))
  ' >/dev/null
  kubectl rollout status deployment/agent-sandbox-controller -n agent-sandbox-system \
    --timeout="${TIMEOUT_SECONDS}s"
  kubectl get runtimeclass opencrane-smoke-runc -o json | jq -e '.handler == "runc"' >/dev/null
  kubectl get "sandboxtemplate/${RELEASE_NAME}-developer-template" -n "$NAMESPACE" -o json \
    | jq -e '.spec.podTemplate.spec.runtimeClassName == "opencrane-smoke-runc"' >/dev/null
  kubectl get sandboxwarmpool/developer-pool -n "$NAMESPACE" -o json \
    | jq -e '.spec.replicas == 0' >/dev/null
  bash "$ROOT_DIR/apps/_infra/agent-sandbox/tests/claim-admission-smoke.sh" "k3d-${CLUSTER_NAME}" "$NAMESPACE" "$RELEASE_NAME"
  bash "$ROOT_DIR/apps/_infra/agent-sandbox/tests/claim-lifecycle-smoke.sh" "k3d-${CLUSTER_NAME}" "$NAMESPACE" "$RELEASE_NAME" "$TIMEOUT_SECONDS"
  kubectl exec -i "deployment/${RELEASE_NAME}-opencrane-server" -n "$NAMESPACE" -- node --input-type=module - "$CLUSTER_TENANT" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import https from "node:https";

const endpoint = `https://${process.env.OPENCRANE_HISTORY_STORE_ENDPOINT}`;
const ca = readFileSync(process.env.OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH);
const username = readFileSync(process.env.OPENCRANE_HISTORY_STORE_USERNAME_PATH, "utf8").trim();
const password = readFileSync(process.env.OPENCRANE_HISTORY_STORE_PASSWORD_PATH, "utf8").trim();
assert.equal(username, "opencrane-history");
function status(path, authenticated = false, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = https.request(`${endpoint}${path}`, {
      ca,
      method,
      rejectUnauthorized: true,
      ...(authenticated ? { auth: `${username}:${password}` } : {}),
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
      response.once("error", reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error("KurrentDB probe timed out")));
    request.once("error", reject);
    request.end();
  });
}
assert.ok([200, 204].includes(await status("/health/live")), "Anonymous TLS health must succeed");
assert.ok([401, 403].includes(await status("/users")), "Anonymous administration must be refused");
assert.ok([401, 403].includes(await status("/streams/opencrane-silo/0")), "Anonymous ledger reads must be refused");
assert.equal(await status("/streams/opencrane-silo/0", true), 200, "The service identity must read the server's silo sentinel");
const activationStream = encodeURIComponent(`computer-activations-${process.argv[2]}`);
assert.ok([401, 403].includes(await status(`/subscriptions/${activationStream}/conversation-computer-activation/replayParked`, true, "POST")), "The application service identity must not replay parked activations");
NODE
  OPENCRANE_CHART_DIR="$ROOT_DIR/apps/_infra/deploy-k8s" \
    bash "$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh" \
    --cluster-tenant "$CLUSTER_TENANT" --namespace "$NAMESPACE" --release "$RELEASE_NAME" \
    --release-version "$(jq -r '.version' "$ROOT_DIR/package.json")" --kurrentdb-replay-parked
}

# The Tier 3 down command reuses these read-only ownership checks and the same image cleanup.
# Neither mode starts a smoke cluster or executes the ordinary deploy path.
if ! [[ "$CLUSTER_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "[develop-smoke] CLUSTER_NAME must be a lowercase k3d-safe cluster name." >&2
  exit 1
fi
if ! [[ "$SMOKE_IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || (( ${#SMOKE_IMAGE_TAG} > 128 )); then
  echo "[develop-smoke] SMOKE_RESOURCE_OWNER cannot form a safe per-run Docker image tag." >&2
  exit 1
fi
case "${1:-}" in
  --assert-owned-resources)
    _assert_owned_resource_set
    exit 0
    ;;
  --prune-owned-images)
    _assert_owned_resource_set
    if docker inspect "k3d-${CLUSTER_NAME}-server-0" >/dev/null 2>&1 \
      || docker inspect "k3d-${SMOKE_LOCAL_REGISTRY_NAME}" >/dev/null 2>&1; then
      echo "[develop-smoke] Refusing image cleanup while the owner cluster or registry is retained." >&2
      exit 1
    fi
    _prune_owned_smoke_images
    exit 0
    ;;
  "") ;;
  *) echo "[develop-smoke] Unknown internal mode '$1'." >&2; exit 2 ;;
esac

trap _cleanup EXIT
# Bash skips the EXIT trap on untrapped fatal signals — an interrupted run would strand the
# k3d node containers and their multi-GB writable layers. Route the signals through exit.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in curl docker git helm jq k3d kubectl openssl; do _require_command "$command"; done
docker info >/dev/null 2>&1 || { echo "[develop-smoke] Docker daemon is not reachable." >&2; exit 1; }
if [[ "$SMOKE_STORAGE_MODE" != "fast" && "$SMOKE_STORAGE_MODE" != "full" ]]; then
  echo "[develop-smoke] SMOKE_STORAGE_MODE must be 'fast' or 'full', got '$SMOKE_STORAGE_MODE'." >&2
  exit 1
fi
if ! [[ "$SMOKE_INGRESS_PORT" =~ ^[0-9]+$ ]] || (( SMOKE_INGRESS_PORT < 1024 || SMOKE_INGRESS_PORT > 65535 )); then
  echo "[develop-smoke] SMOKE_INGRESS_PORT must be a user port from 1024 through 65535." >&2
  exit 1
fi
if [[ -n "$OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL" ]] && ! [[ "$OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  echo "[develop-smoke] OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL must contain one 32-byte base64url proof." >&2
  exit 1
fi

echo "[develop-smoke] Creating disposable k3d cluster '$CLUSTER_NAME'"
_assert_owned_resource_set
if docker inspect "k3d-${CLUSTER_NAME}-server-0" >/dev/null 2>&1; then
  _assert_owned_resource_set
  if docker inspect "k3d-${SMOKE_LOCAL_REGISTRY_NAME}" >/dev/null 2>&1; then
    k3d registry delete "$SMOKE_LOCAL_REGISTRY_NAME"
  fi
  _assert_owned_resource_set
  k3d cluster delete "$CLUSTER_NAME"
elif docker inspect "k3d-${SMOKE_LOCAL_REGISTRY_NAME}" >/dev/null 2>&1; then
  _assert_owned_resource_set
  k3d registry delete "$SMOKE_LOCAL_REGISTRY_NAME"
fi
_assert_owned_resource_set
_prune_owned_smoke_images

# Image preparation is the longest independent lane. Start it before k3d so cluster creation and
# external-controller readiness consume the same wall-clock time without serialising all builds
# against the runner's small Docker daemon. Prior owner images are gone before this lane starts.
_prepare_images &
IMAGE_PREPARATION_PID=$!

k3d registry create "$SMOKE_LOCAL_REGISTRY_NAME" --port 127.0.0.1:0 --no-help
SMOKE_REGISTRY_CONTAINER_ID="$(docker inspect --format '{{.Id}}' "k3d-${SMOKE_LOCAL_REGISTRY_NAME}")"
SMOKE_REGISTRY_CREATED=1
registry_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostPort}}' "k3d-${SMOKE_LOCAL_REGISTRY_NAME}")"
[[ "$registry_port" =~ ^[0-9]+$ ]] || { echo "[develop-smoke] Registry has no loopback host port" >&2; exit 1; }
SMOKE_LOCAL_REGISTRY_ADDRESS="127.0.0.1:${registry_port}"
cluster_create_arguments=(cluster create "$CLUSTER_NAME" --image "$K3S_IMAGE" --port "${SMOKE_INGRESS_PORT}:443@loadbalancer" --registry-use "k3d-${SMOKE_LOCAL_REGISTRY_NAME}:5000" --wait)
cluster_create_arguments+=(--runtime-label "opencrane.tier3.owner=${SMOKE_RESOURCE_OWNER}@all")
k3d "${cluster_create_arguments[@]}"
SMOKE_CLUSTER_CREATED=1

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

"$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh" --provision-agent-sandbox-controller --context "k3d-${CLUSTER_NAME}"
# This class truthfully names k3d's native runtime. Only a separate gVisor install can qualify isolation.
cat <<'EOF' | kubectl apply -f -
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: opencrane-smoke-runc
handler: runc
EOF

if ! wait "$IMAGE_PREPARATION_PID"; then
  IMAGE_PREPARATION_PID=""
  echo "[develop-smoke] Image preparation failed" >&2
  exit 1
fi
IMAGE_PREPARATION_PID=""
echo "[develop-smoke] Importing the tag-based service images in one k3d transfer"
_retry 3 k3d image import "${SMOKE_IMAGES[@]}" --cluster "$CLUSTER_NAME" --mode direct
bootstrap_digest="$(_publish_smoke_image "opencrane/kurrentdb-bootstrap:${SMOKE_IMAGE_TAG}" opencrane-kurrentdb-bootstrap)"
computer_digest="$(_publish_smoke_image "opencrane/conversation-computer:${SMOKE_IMAGE_TAG}" opencrane-conversation-computer)"
registry_repository="k3d-${SMOKE_LOCAL_REGISTRY_NAME}:5000"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
"$ROOT_DIR/apps/_infra/deploy-k8s/platform/provision-kurrentdb-bootstrap-secrets.sh" \
  --namespace "$NAMESPACE" --release "$RELEASE_NAME"

echo "[develop-smoke] Creating isolated database and fleet-verification inputs"
_create_database_credentials "$POSTGRES_CREDENTIALS_SECRET" opencrane "$(_random_secret)"
_create_database_credentials "$LITELLM_POSTGRES_CREDENTIALS_SECRET" litellm "$(_random_secret)"
_create_database_credentials "$POSTGRES_ADMIN_CREDENTIALS_SECRET" opencrane_database_admin "$(_random_secret)"

KEY_DIR="$(mktemp -d)"
openssl genpkey -algorithm ED25519 -out "$KEY_DIR/private-key.pem"
openssl pkey -in "$KEY_DIR/private-key.pem" -pubout -out "$KEY_DIR/public-key.pem"
kubectl create secret generic opencrane-fleet-membership-verification \
  --namespace "$NAMESPACE" \
  --from-file=public-key.pem="$KEY_DIR/public-key.pem" \
  --dry-run=client -o yaml | kubectl apply -f -

DEVELOPMENT_AUTH_HELM_ARGS=(--set-string "clustertenantManager.developmentAuthentication.mode=")
if [[ -n "$OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL" ]]; then
  development_credential_file="$KEY_DIR/development-session"
  printf '%s' "$OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL" >"$development_credential_file"
  chmod 600 "$development_credential_file"
  kubectl create secret generic "${RELEASE_NAME}-development-session" \
    --namespace "$NAMESPACE" \
    --from-file=credential="$development_credential_file" \
    --dry-run=client -o yaml | kubectl apply -f -
  DEVELOPMENT_AUTH_HELM_ARGS=(
    --set-string "clustertenantManager.developmentAuthentication.mode=k3d"
    --set-string "clustertenantManager.developmentAuthentication.publicHost=${CONTROL_PLANE_HOST}"
    --set-string "clustertenantManager.developmentAuthentication.existingSecret=${RELEASE_NAME}-development-session"
    --set-string "clustertenantManager.oidc.issuerUrl="
    --set-string "clustertenantManager.oidc.clientId="
    --set-string "clustertenantManager.oidc.redirectUri="
    --set-string "clustertenantManager.oidc.existingSecret="
  )
fi

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
  --image-tag "$SMOKE_IMAGE_TAG" \
  --cognee-tag "$SMOKE_IMAGE_TAG" \
  --storage-class "$SMOKE_STORAGE_CLASS" \
  --postgres-credentials-secret "$POSTGRES_CREDENTIALS_SECRET" \
  --litellm-postgres-credentials-secret "$LITELLM_POSTGRES_CREDENTIALS_SECRET" \
  --postgres-admin-credentials-secret "$POSTGRES_ADMIN_CREDENTIALS_SECRET" \
  --postgres-values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-postgres-values.yaml" \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml" \
  --set-string "historyStore.kurrentdb.tls.existingSecret=${RELEASE_NAME}-kurrentdb-tls" \
  --set-string "historyStore.kurrentdb.bootstrapAdmin.existingSecret=${RELEASE_NAME}-kurrentdb-bootstrap" \
  --set-string "historyStore.kurrentdb.bootstrapOps.existingSecret=${RELEASE_NAME}-kurrentdb-bootstrap-ops" \
  --set-string "historyStore.kurrentdb.serviceCredential.existingSecret=${RELEASE_NAME}-kurrentdb-history-service" \
  --set-string "historyStore.kurrentdb.bootstrap.image.repository=${registry_repository}/opencrane-kurrentdb-bootstrap" \
  --set-string "historyStore.kurrentdb.bootstrap.image.digest=${bootstrap_digest}" \
  --set-string "agentSandbox.namespace=${NAMESPACE}" \
  --set-string "agentSandbox.serviceAccountName=${RELEASE_NAME}-agent-sandbox" \
  --set-string "agentSandbox.profiles[0].image.repository=${registry_repository}/opencrane-conversation-computer" \
  --set-string "agentSandbox.profiles[0].image.digest=${computer_digest}" \
  "${DEVELOPMENT_AUTH_HELM_ARGS[@]}" \
  --set "certManager.mode=selfSigned" \
  --set "certManager.issuerName=opencrane-develop-smoke-issuer"

echo "[develop-smoke] Waiting for every enabled workload and certificate"
kubectl wait --for=condition=available deployment --all -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=available deployment --all -n "$ARTIFACT_NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"
kubectl wait --for=condition=Ready "certificate/${RELEASE_NAME}-clustertenant-tls" \
  -n "$NAMESPACE" --timeout="${TIMEOUT_SECONDS}s"

_assert_database_isolation
_assert_current_history_and_sandbox
_assert_ingress_health

echo "[develop-smoke] PASS: current service readiness, database isolation, authenticated KurrentDB TLS, anonymous health/read boundaries, Agent Sandbox claim reconciliation and cleanup with its runc profile, TLS ingress, and $SMOKE_STORAGE_MODE storage qualification"
