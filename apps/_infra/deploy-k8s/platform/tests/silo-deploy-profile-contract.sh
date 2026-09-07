#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh"
DEVELOP_SMOKE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh"
PROVIDER_SECRET_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/provider-key-secrets.sh"
KURRENTDB_SECRET_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/provision-kurrentdb-bootstrap-secrets.sh"
COGNEE_POLICY="$ROOT_DIR/apps/_infra/cognee/deploy/image-policy.sh"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
trap cleanup_current_chart_sources EXIT
prepare_current_chart_sources
CHART_DIR="$(current_chart_sources_dir)"

grep -Fq -- '--acme-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--first-user-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap' "$DEPLOY_SCRIPT"
grep -Fq -- '--opencrane-ui-digest sha256:REVIEWED_BROWSER_BUILD_DIGEST' "$DEPLOY_SCRIPT"
grep -Fq -- '--cognee-digest sha256:REVIEWED_COGNEE_BUILD_DIGEST' "$DEPLOY_SCRIPT"
grep -Fq -- '--kurrentdb-image-digest sha256:REVIEWED_KURRENTDB_IMAGE_DIGEST' "$DEPLOY_SCRIPT"
grep -Fq -- '--kurrentdb-bootstrap-ops-secret' "$DEPLOY_SCRIPT"
grep -Fq -- '--kurrentdb-service-credential-secret' "$DEPLOY_SCRIPT"
grep -Fq -- '--kurrentdb-bootstrap-image-repository' "$DEPLOY_SCRIPT"
grep -Fq -- '--kurrentdb-bootstrap-image-digest' "$DEPLOY_SCRIPT"
grep -Fq -- '--agent-sandbox-image-repository' "$DEPLOY_SCRIPT"
grep -Fq -- '--agent-sandbox-image-digest' "$DEPLOY_SCRIPT"
grep -Fq -- 'testv5 requires the Kubernetes Agent Sandbox CRD' "$DEPLOY_SCRIPT"
grep -Fq -- 'testv5 requires the Agent Sandbox controller to use an immutable image digest' "$DEPLOY_SCRIPT"
grep -Fq -- 'testv5 requires the Agent Sandbox extensions reconciler' "$DEPLOY_SCRIPT"
grep -Fq -- 'testv5 requires a Ready Agent Sandbox controller' "$DEPLOY_SCRIPT"
grep -Fq -- 'testv5 requires the approved gvisor RuntimeClass' "$DEPLOY_SCRIPT"
grep -Fq -- "requires key '\$required_tls_key'" "$DEPLOY_SCRIPT"
grep -Fq -- "requires key 'password'" "$DEPLOY_SCRIPT"
grep -Fq -- "must set immutable: true" "$DEPLOY_SCRIPT"
grep -Fq -- "must use username 'opencrane-history'" "$DEPLOY_SCRIPT"
grep -Fq -- 'historyStore.kurrentdb.enabled=true' "$DEPLOY_SCRIPT"
grep -Fq -- 'Fresh silo deploys require `--opencrane-ui-digest` and `--cognee-digest`' "$DEPLOY_SCRIPT"
grep -Fq -- 'ensure_provider_key_secrets' "$PROVIDER_SECRET_HELPER"
grep -Fq -- 'kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- "jq '.immutable = true'" "$KURRENTDB_SECRET_HELPER"
grep -Fq -- 'service_fqdn="${service_dns}.cluster.local"' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- 'openssl x509 -checkhost "$expected_service_dns"' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- 'certificate and private key do not match' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- '_read_secret_key "$ADMIN_SECRET" password' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- '--from-literal=username=opencrane-history' "$KURRENTDB_SECRET_HELPER"
grep -Fq -- 'ACME_EMAIL="${OPENCRANE_ACME_EMAIL:-}"' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_ISSUER_URL="$2"; PASSTHROUGH+=(--oidc-issuer-url "$2")' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_CLIENT_ID="$2"; PASSTHROUGH+=(--oidc-client-id "$2")' "$DEPLOY_SCRIPT"
grep -Fq -- '--cluster-tenant "$CLUSTER_TENANT"' "$DEPLOY_SCRIPT"
grep -Fq -- '--acme-email is required to issue a browser-trusted certificate' "$DEPLOY_SCRIPT"
grep -Fq -- '--first-user-email is required to claim this standalone silo' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.mode=acme"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.issuerName=opencrane-acme-issuer"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set "certManager.acme.email=${ACME_EMAIL}"' "$DEPLOY_SCRIPT"
grep -Fq -- '--set-string "clustertenantManager.firstUser.clusterTenant=${CLUSTER_TENANT}"' "$DEPLOY_SCRIPT"
grep -Fq -- '--acme-email "$SMOKE_ACME_EMAIL"' "$DEVELOP_SMOKE"
grep -Fq -- '--first-user-email "$SMOKE_FIRST_USER_EMAIL"' "$DEVELOP_SMOKE"
grep -Fq -- '--set "certManager.mode=selfSigned"' "$DEVELOP_SMOKE"
grep -Fq -- '--set "certManager.issuerName=opencrane-develop-smoke-issuer"' "$DEVELOP_SMOKE"
grep -Fq -- 'OPENCRANE_ALLOW_TAG_FLOAT=1' "$DEVELOP_SMOKE"
DEPLOY_CORE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/k8s-deploy.sh"
IMAGE_POLICY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/control-plane-image-policy.sh"
if grep -Eq -- '--initial-model-provider|OPENCRANE_INITIAL_MODEL_(PROVIDER|API_KEY)' "$DEPLOY_SCRIPT" "$DEPLOY_CORE"; then
  echo "deploy scripts still accept the retired provider-bootstrap input" >&2
  exit 1
fi
grep -Fq -- 'OPENCRANE_ALLOW_TAG_FLOAT=1 is restricted to a disposable local k3d .test domain' "$IMAGE_POLICY"
grep -Fq -- '--opencrane-ui-tag (or OPENCRANE_UI_TAG) is only allowed with OPENCRANE_ALLOW_TAG_FLOAT=1' "$IMAGE_POLICY"
grep -Fq -- "Retaining existing OIDC secret '\$OIDC_SECRET_NAME'" "$DEPLOY_CORE"
grep -Fq -- "no complete '\$OIDC_SECRET_NAME' exists" "$DEPLOY_CORE"
grep -Fq -- "jsonpath='{.data.OIDC_CLIENT_SECRET}'" "$DEPLOY_CORE"
grep -Fq -- "jsonpath='{.data.OIDC_SESSION_SECRET}'" "$DEPLOY_CORE"
grep -Fq -- '--set "litellm.storeModelInDb=true"' "$DEPLOY_CORE"
grep -Fq -- '--set-string "litellm.existingSaltSecret=opencrane-litellm"' "$DEPLOY_CORE"
grep -Fq -- '--set-string "litellm.saltSecretKey=LITELLM_SALT_KEY"' "$DEPLOY_CORE"
grep -Fq -- '--first-user-email)             FIRST_USER_EMAIL="$2"' "$DEPLOY_CORE"
grep -Fq -- '--set-string)    EXTRA_SET+=(--set-string "$2")' "$DEPLOY_CORE"
grep -Fq -- '--set-string "clustertenantManager.firstUser.email=$FIRST_USER_EMAIL"' "$DEPLOY_CORE"
grep -Fq -- '_guard_standalone_first_user_issuer' "$DEPLOY_CORE"
grep -Fq -- 'Standalone first-owner issuer is immutable after deployment' "$DEPLOY_CORE"
grep -Fq -- 'prior_first_user_email' "$DEPLOY_CORE"
grep -Fq -- 'prior_first_user_cluster_tenant' "$DEPLOY_CORE"
grep -Fq -- 'Standalone first-owner email is immutable after deployment' "$DEPLOY_CORE"
grep -Fq -- 'omitting --first-user-email' "$DEPLOY_CORE"
grep -Fq -- 'requires --oidc-issuer-url on every upgrade' "$DEPLOY_CORE"
grep -Fq -- 'Do not use --values or --reset-values' "$DEPLOY_CORE"
grep -Fq -- 'Do not override clustertenantManager.firstUser through --helm-arg' "$DEPLOY_CORE"
grep -Fq -- 'clustertenantManager.firstUser.clusterTenant=$prior_first_user_cluster_tenant' "$DEPLOY_CORE"
grep -Fq -- '"$extra_set_flag" == "--set-string"' "$DEPLOY_CORE"
grep -Fq -- '"${EXTRA_HELM_ARGS[@]-}"' "$DEPLOY_CORE"
grep -Fq -- 'if [[ ${#EXTRA_SET[@]} -gt 0 ]]; then' "$DEPLOY_CORE"
grep -Fq -- $'  --server-side=true\n  --force-conflicts' "$DEPLOY_CORE"
grep -Fq -- 'SKILL_AUTHORING_NAMESPACE="${RELEASE}-skill-authoring"' "$DEPLOY_CORE"
grep -Fq -- 'MCP_EXECUTOR_NAMESPACE="${RELEASE}-mcp-executors"' "$DEPLOY_CORE"
grep -Fq -- 'ARTIFACT_NAMESPACE_RESOURCE="$(kubectl get namespace "$ARTIFACT_NAMESPACE" --ignore-not-found -o name)"' "$DEPLOY_CORE"
grep -Fq -- 'if [[ -n "$ARTIFACT_NAMESPACE_RESOURCE" ]]; then' "$DEPLOY_CORE"
grep -Fq -- 'if [[ -z "$ARTIFACT_NAMESPACE_OWNER" ]]; then' "$DEPLOY_CORE"
grep -Fq -- '_adopt_legacy_artifact_namespace' "$DEPLOY_CORE"
grep -Fq -- 'resource_name="${RELEASE}-artifact-service"' "$DEPLOY_CORE"
grep -Fq -- 'for resource in deployment persistentvolumeclaim service serviceaccount networkpolicy; do' "$DEPLOY_CORE"
grep -Fq -- 'jsonpath={.metadata.labels.app\.kubernetes\.io/managed-by}' "$DEPLOY_CORE"
grep -Fq -- 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-name}' "$DEPLOY_CORE"
grep -Fq -- 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-namespace}' "$DEPLOY_CORE"
grep -Fq -- 'kubectl label namespace "$ARTIFACT_NAMESPACE" "$RETIREMENT_OWNER_LABEL=$RELEASE"' "$DEPLOY_CORE"
grep -Fq -- 'elif [[ "$ARTIFACT_NAMESPACE_OWNER" != "$RELEASE" ]]; then' "$DEPLOY_CORE"
grep -Fq -- "Artifact namespace '\$ARTIFACT_NAMESPACE' belongs to '\${ARTIFACT_NAMESPACE_OWNER:-an unknown owner}', not '\$RELEASE'." "$DEPLOY_CORE"
grep -Fq -- 'kubectl label --local --filename - "$RETIREMENT_OWNER_LABEL=$RELEASE" --overwrite --output yaml' "$DEPLOY_CORE"
grep -Fq -- '| kubectl create -f -' "$DEPLOY_CORE"
if grep -Fq -- 'kubectl label namespace "$ARTIFACT_NAMESPACE" "opencrane.ai/retirement-owner=$RELEASE" --overwrite' "$DEPLOY_CORE"; then
  echo 'artifact namespace ownership is overwritten imperatively' >&2
  exit 1
fi
grep -Fq -- '--set-string "opencrane-skill-authoring.skillAuthoring.namespace=$SKILL_AUTHORING_NAMESPACE"' "$DEPLOY_CORE"
grep -Fq -- '--set-string "opencrane-mcp-executor.mcpExecutor.namespace=$MCP_EXECUTOR_NAMESPACE"' "$DEPLOY_CORE"
grep -Fq -- 'EXPECTED_RELEASE="opencrane-${CLUSTER_TENANT}"' "$DEPLOY_SCRIPT"
grep -Fq -- '--release "$RELEASE"' "$DEPLOY_SCRIPT"
extra_args_line="$(grep -nF '[[ ${#EXTRA_HELM_ARGS[@]} -gt 0 ]]' "$DEPLOY_CORE" | cut -d: -f1)"
skill_namespace_line="$(grep -nF -- '--set-string "opencrane-skill-authoring.skillAuthoring.namespace=$SKILL_AUTHORING_NAMESPACE"' "$DEPLOY_CORE" | cut -d: -f1)"
(( skill_namespace_line > extra_args_line ))
grep -Fq -- 'resolve_cluster_tenant_crd_install' "$DEPLOY_CORE"
grep -Fq -- '--set "crds.install=$CRDS_INSTALL"' "$DEPLOY_CORE"
crd_install_line="$(grep -nF -- '--set "crds.install=$CRDS_INSTALL"' "$DEPLOY_CORE" | cut -d: -f1)"
(( crd_install_line > extra_args_line ))
grep -Fq -- '--opencrane-ui-digest) CONTROL_PLANE_SPA_DIGEST="$2"' "$DEPLOY_CORE"
grep -Fq -- '--cognee-digest) COGNEE_DIGEST="$2"' "$DEPLOY_CORE"
grep -Fq -- 'clustertenantManager.cognee.image.digest // empty' "$DEPLOY_CORE"
grep -Fq -- 'Cognee must use --cognee-digest with an exact sha256 OCI digest' "$ROOT_DIR/apps/_infra/cognee/deploy/image-policy.sh"
grep -Fq -- 'clustertenantManager.cognee.image.digest=$COGNEE_DIGEST' "$COGNEE_POLICY"
grep -Fq -- 'clustertenantManager.cognee.image.repository=$COGNEE_IMAGE_REPOSITORY' "$COGNEE_POLICY"
grep -Fq -- 'validate_cognee_helm_passthrough' "$DEPLOY_CORE"
grep -Fq -- 'append_authoritative_cognee_image_helm_args' "$DEPLOY_CORE"
grep -Fq -- '--post-renderer|--post-renderer=*|--post-renderer-args|--post-renderer-args=*' "$COGNEE_POLICY"
grep -Fq -- 'controlPlaneSpa.image.digest // empty' "$DEPLOY_CORE"
grep -Fq -- 'OpenCrane SPA must use --opencrane-ui-digest with an exact sha256 OCI digest' "$IMAGE_POLICY"
grep -Fq -- 'controlPlaneSpa.image.digest=$CONTROL_PLANE_SPA_DIGEST' "$DEPLOY_CORE"
grep -Fq -- 'wait_for_final_deployment_if_present "${RELEASE}-opencrane-ui-spa"' "$DEPLOY_CORE"
grep -Fq -- '_verify_control_plane_spa_rollout' "$DEPLOY_CORE"
grep -Fq -- 'wait_for_final_deployment_if_present "${RELEASE}-cognee"' "$DEPLOY_CORE"
grep -Fq -- '_verify_cognee_rollout' "$DEPLOY_CORE"
grep -Fq -- 'wait_for_final_statefulset_if_present "${RELEASE}-kurrentdb"' "$DEPLOY_CORE"
grep -Fq -- 'wait_for_final_kurrentdb_bootstrap_job_if_present' "$DEPLOY_CORE"
grep -Fq -- 'kubectl describe "job/$job_name"' "$DEPLOY_CORE"
grep -Fq -- 'kubectl logs "job/$job_name"' "$DEPLOY_CORE"

# Exercise the installer's actual wait function with Job responses and a clock advanced by sleep.
(
  bootstrap_wait_test_dir="$(mktemp -d)"
  trap 'rm -rf "$bootstrap_wait_test_dir"' EXIT
  eval "$(sed -n '/^wait_for_final_kurrentdb_bootstrap_job_if_present()$/,/^}/p' "$DEPLOY_CORE")"
  RELEASE=opencrane-testv5
  NAMESPACE=opencrane-testv5
  TIMEOUT=7
  unset SECONDS
  err() { printf '%s\n' "$*" >&2; }
  sleep()
  {
    printf '%s\n' "$1" >>"$bootstrap_wait_test_dir/sleeps"
    SECONDS=$((SECONDS + $1))
  }
  kubectl()
  {
    printf '%s\n' "$*" >>"$bootstrap_wait_test_dir/calls"
    if [[ "$*" != *' -o json '* ]]; then return 0; fi
    local read_count
    read_count="$(cat "$bootstrap_wait_test_dir/reads")"
    read_count=$((read_count + 1))
    printf '%s' "$read_count" >"$bootstrap_wait_test_dir/reads"
    case "$bootstrap_wait_case" in
      missing) return 0 ;;
      read-error) return 23 ;;
      later-read-error) if (( read_count > 1 )); then return 23; fi ;;
      disappears) if (( read_count > 1 )); then return 0; fi ;;
      malformed) printf '{invalid'; return 0 ;;
      wrong-object) printf '{}'; return 0 ;;
    esac
    local condition=""
    case "$bootstrap_wait_case" in
      complete) condition=Complete ;;
      failed) condition=Failed ;;
      failure-target) condition=FailureTarget ;;
      running-complete) if (( read_count > 1 )); then condition=Complete; fi ;;
      running-failed) if (( read_count > 1 )); then condition=Failed; fi ;;
    esac
    jq -nc --arg condition "$condition" '{apiVersion:"batch/v1", kind:"Job", status:{failed:1,
      conditions: ([{type:"Failed",status:"False"}] +
        (if $condition == "" then [] else [{type:$condition,status:"True"}] end))}}'
  }
  for bootstrap_wait_case in missing complete failed failure-target running-complete running-failed running read-error later-read-error disappears malformed wrong-object; do
    printf '0' >"$bootstrap_wait_test_dir/reads"
    : >"$bootstrap_wait_test_dir/calls"
    : >"$bootstrap_wait_test_dir/sleeps"
    SECONDS=0
    if wait_for_final_kurrentdb_bootstrap_job_if_present >"$bootstrap_wait_test_dir/output" 2>&1; then
      bootstrap_wait_status=0
    else
      bootstrap_wait_status=$?
    fi
    expected_status=1
    expected_reads=1
    expected_sleeps=0
    case "$bootstrap_wait_case" in
      missing|complete) expected_status=0 ;;
      running-complete) expected_status=0; expected_reads=2; expected_sleeps=1 ;;
      running-failed|disappears) expected_reads=2; expected_sleeps=1 ;;
      read-error) expected_status=23 ;;
      later-read-error) expected_status=23; expected_reads=2; expected_sleeps=1 ;;
      running) expected_reads=4; expected_sleeps=4 ;;
    esac
    if [[ "$bootstrap_wait_status" != "$expected_status" || "$(cat "$bootstrap_wait_test_dir/reads")" != "$expected_reads" || "$(wc -l <"$bootstrap_wait_test_dir/sleeps" | tr -d ' ')" != "$expected_sleeps" ]]; then
      echo "KurrentDB bootstrap wait returned an incorrect result or timing for $bootstrap_wait_case." >&2
      cat "$bootstrap_wait_test_dir/output" "$bootstrap_wait_test_dir/calls" >&2
      exit 1
    fi
    if [[ "$bootstrap_wait_case" == failed || "$bootstrap_wait_case" == failure-target || "$bootstrap_wait_case" == running-failed ]]; then
      grep -Fq 'reported terminal failure' "$bootstrap_wait_test_dir/output" || exit 1
      grep -Fq 'logs job/opencrane-testv5-kurrentdb-bootstrap' "$bootstrap_wait_test_dir/calls" || exit 1
    fi
    if [[ "$bootstrap_wait_case" == running ]]; then
      [[ "$(tr '\n' ' ' <"$bootstrap_wait_test_dir/sleeps")" == '2 2 2 1 ' ]] || exit 1
      grep -Fq -- '--request-timeout=1s' "$bootstrap_wait_test_dir/calls" || exit 1
    fi
  done

  # Bootstrap must finish before an existing release waits for its database consumers.
  source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/database-release-finalization.sh"
  bootstrap_gate="$(grep -Fx 'wait_for_final_kurrentdb_bootstrap_job_if_present || exit $?' "$DEPLOY_CORE")"
  consumer_roll="$(sed -n '/^if \[\[ "\$RELEASE_PREEXISTED" == "1" \]\]; then$/,/^fi$/p' "$DEPLOY_CORE")"
  server_finalization="$(sed -n '/^wait_for_final_deployment_if_present "${RELEASE}-opencrane-server" || exit /,/^_post_deploy_verify || exit /p' "$DEPLOY_CORE")"
  bootstrap_gate_line="$(grep -nFx 'wait_for_final_kurrentdb_bootstrap_job_if_present || exit $?' "$DEPLOY_CORE" | cut -d: -f1)"
  consumer_roll_line="$(grep -nF '  roll_database_consumers_for_finalization "$NAMESPACE" "$TIMEOUT"' "$DEPLOY_CORE" | cut -d: -f1)"
  server_gate_line="$(grep -nF 'wait_for_final_deployment_if_present "${RELEASE}-opencrane-server" || exit $?' "$DEPLOY_CORE" | cut -d: -f1)"
  (( bootstrap_gate_line < consumer_roll_line && consumer_roll_line < server_gate_line )) || exit 1
  [[ -n "$bootstrap_gate" && -n "$consumer_roll" && -n "$server_finalization" ]] || exit 1
  final_wait_calls="$(printf '%s\n' "$bootstrap_gate" "$consumer_roll" "$server_finalization")"
  [[ -n "$final_wait_calls" ]] || exit 1
  POSTGRES_APP_SECRET=fixture-postgres
  LITELLM_POSTGRES_APP_SECRET=fixture-litellm
  POSTGRES_ADMIN_APP_SECRET=fixture-admin
  compute_database_connection_checksum() { printf 'fixture-checksum'; }
  roll_database_consumers_for_finalization()
  {
    printf 'consumers\n' >>"$bootstrap_wait_test_dir/final-calls"
    return "$consumer_exit"
  }
  wait_for_final_kurrentdb_bootstrap_job_if_present()
  {
    printf '%s\n' bootstrap >>"$bootstrap_wait_test_dir/final-calls"
    return "$bootstrap_exit"
  }
  kubectl()
  {
    printf '%s\n' "$*" >>"$bootstrap_wait_test_dir/final-calls"
    case "$1 $2" in
      'get deployment/opencrane-testv5-opencrane-server') printf '%s\n' deployment.apps/opencrane-testv5-opencrane-server ;;
      'rollout status') return "$server_exit" ;;
      *) echo "Unexpected finalization command: $*" >&2; return 99 ;;
    esac
  }
  _wait_for_release_certificate() { printf '%s\n' certificate >>"$bootstrap_wait_test_dir/final-calls"; }
  _post_deploy_verify() { printf '%s\n' verify >>"$bootstrap_wait_test_dir/final-calls"; }
  for final_wait_case in success fresh-success bootstrap-failure consumer-failure server-failure; do
    : >"$bootstrap_wait_test_dir/final-calls"
    RELEASE_PREEXISTED=1
    bootstrap_exit=0
    consumer_exit=0
    server_exit=0
    expected_status=0
    case "$final_wait_case" in
      fresh-success) RELEASE_PREEXISTED=0 ;;
      bootstrap-failure) bootstrap_exit=17; expected_status=17 ;;
      consumer-failure) consumer_exit=31; expected_status=31 ;;
      server-failure) server_exit=47; expected_status=47 ;;
    esac
    if (eval "$final_wait_calls") >"$bootstrap_wait_test_dir/final-output" 2>&1; then
      final_wait_status=0
    else
      final_wait_status=$?
    fi
    [[ "$final_wait_status" == "$expected_status" ]] || exit 1
    [[ "$(head -n 1 "$bootstrap_wait_test_dir/final-calls")" == bootstrap ]] || exit 1
    if [[ "$final_wait_case" == bootstrap-failure ]]; then
      [[ "$(wc -l <"$bootstrap_wait_test_dir/final-calls" | tr -d ' ')" == 1 ]] || exit 1
    elif [[ "$final_wait_case" == consumer-failure ]]; then
      [[ "$(cat "$bootstrap_wait_test_dir/final-calls")" == $'bootstrap\nconsumers' ]] || exit 1
    else
      grep -Fq 'rollout status deployment/opencrane-testv5-opencrane-server -n opencrane-testv5 --timeout=7s' "$bootstrap_wait_test_dir/final-calls" || exit 1
    fi
    if [[ "$final_wait_case" == success || "$final_wait_case" == fresh-success ]]; then
      [[ "$(tail -n 1 "$bootstrap_wait_test_dir/final-calls")" == verify ]] || exit 1
    elif grep -Fxq verify "$bootstrap_wait_test_dir/final-calls"; then
      echo 'A failed bootstrap or server rollout reached advisory verification.' >&2
      exit 1
    fi
    if [[ "$final_wait_case" == success ]]; then
      [[ "$(sed -n '2p' "$bootstrap_wait_test_dir/final-calls")" == consumers ]] || exit 1
    elif [[ "$final_wait_case" == fresh-success ]] && grep -Fxq consumers "$bootstrap_wait_test_dir/final-calls"; then
      echo 'A fresh installation unexpectedly rolled database consumers.' >&2
      exit 1
    fi
  done

  # Run the entrypoint's parser and retry dispatch so mixed actions cannot reach the cluster.
  retry_parser="$(sed -n '/^while \[\[ \$# -gt 0 \]\]; do$/,/^for c in kubectl helm jq;/p' "$DEPLOY_CORE" | sed '$d')"
  retry_dispatch="$(sed -n '/^if \[\[ "\$KURRENTDB_BOOTSTRAP_RETRY" == "1" \]\]; then$/,/^fi$/p' "$DEPLOY_CORE")"
  [[ -n "$retry_parser" && -n "$retry_dispatch" ]] || exit 1
  retry_guard_line="$(grep -nF 'cannot be combined with restore or preflight actions' "$DEPLOY_CORE" | cut -d: -f1)"
  cluster_access_line="$(grep -nF 'kubectl cluster-info' "$DEPLOY_CORE" | cut -d: -f1)"
  (( retry_guard_line < cluster_access_line )) || exit 1
  for retry_case in success failure preflight environment-preflight restore restore-list restore-confirm; do
    : >"$bootstrap_wait_test_dir/retry-calls"
    retry_exit=0
    expected_status=1
    case "$retry_case" in
      success) expected_status=0 ;;
      failure) retry_exit=29; expected_status=29 ;;
    esac
    if (
      KURRENTDB_BOOTSTRAP_RETRY=0
      KURRENTDB_RESTORE_BACKUP_ID=""
      KURRENTDB_RESTORE_LIST=0
      KURRENTDB_RESTORE_CONFIRM_SERVING=0
      PREFLIGHT=0
      set -- --kurrentdb-bootstrap-retry
      case "$retry_case" in
        preflight) set -- "$@" --preflight ;;
        environment-preflight) PREFLIGHT=1 ;;
        restore) set -- "$@" --kurrentdb-restore latest ;;
        restore-list) set -- "$@" --kurrentdb-restore-list ;;
        restore-confirm) set -- "$@" --kurrentdb-restore-confirm-serving ;;
      esac
      run_kurrentdb_bootstrap_retry() { printf 'retry\n' >>"$bootstrap_wait_test_dir/retry-calls"; return "$retry_exit"; }
      kubectl() { printf 'cluster\n' >>"$bootstrap_wait_test_dir/retry-calls"; return 99; }
      eval "$retry_parser"
      eval "$retry_dispatch"
      printf 'fallthrough\n' >>"$bootstrap_wait_test_dir/retry-calls"
    ) >"$bootstrap_wait_test_dir/retry-output" 2>&1; then
      retry_status=0
    else
      retry_status=$?
    fi
    [[ "$retry_status" == "$expected_status" ]] || exit 1
    if [[ "$retry_case" == success || "$retry_case" == failure ]]; then
      [[ "$(cat "$bootstrap_wait_test_dir/retry-calls")" == retry ]] || exit 1
    else
      [[ ! -s "$bootstrap_wait_test_dir/retry-calls" ]] || exit 1
      grep -Fq 'cannot be combined with restore or preflight actions' "$bootstrap_wait_test_dir/retry-output" || exit 1
    fi
  done
)

# Even an operator override assembled through normal Helm passthrough loses to the digest that the
# deployer verified. This renders the actual chart to prove Helm receives the authority tuple last.
source "$COGNEE_POLICY"
ALLOW_TAG_FLOAT=0
COGNEE_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
COGNEE_TAG=""
helm_args=(
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32'
  --set-literal 'clustertenantManager.cognee.image.repository=registry.invalid/alternate-cognee'
  --set-literal 'clustertenantManager.cognee.image.digest='
  --set-literal 'clustertenantManager.cognee.image.tag=latest')
append_authoritative_cognee_image_helm_args
cognee_deployment="$(helm template opencrane-silo "$CHART_DIR" \
  "${helm_args[@]}" --show-only templates/app-rollups.yaml \
  | awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-silo-cognee/ { print }')"
[[ -n "$cognee_deployment" ]]
grep -Fq 'image: "ghcr.io/elewa-git/opencrane-cognee@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' <<<"$cognee_deployment"
if grep -Fq 'opencrane-cognee:latest' <<<"$cognee_deployment"; then
  echo "operator Cognee tag override survived the authoritative digest" >&2
  exit 1
fi

# The one allowed floating-tag path is the disposable local smoke. It must retain the repository
# that develop-smoke.sh builds and imports into k3d instead of trying to pull the production image.
ALLOW_TAG_FLOAT=1
BASE_DOMAIN="develop-smoke.opencrane.test"
KUBERNETES_CONTEXT="k3d-develop-smoke"
IMAGE_TAG="develop-smoke"
COGNEE_TAG="develop-smoke"
COGNEE_DIGEST=""
resolve_cognee_image_reference
helm_args=(
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32'
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32')
append_authoritative_cognee_image_helm_args
local_cognee_deployment="$(helm template opencrane-silo "$CHART_DIR" \
  "${helm_args[@]}" --show-only templates/app-rollups.yaml \
  | awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: opencrane-silo-cognee/ { print }')"
grep -Fq 'image: "opencrane/cognee:develop-smoke"' <<<"$local_cognee_deployment"

# Strict mode must not abort the immutable issuer guard when the normal
# deployment path provides no raw Helm arguments. Bash may expand this as zero
# entries or one empty entry, neither of which is a supplied Helm argument.
empty_helm_args=()
for _empty_helm_arg in "${empty_helm_args[@]-}"; do
  if [[ -n "$_empty_helm_arg" ]]; then
    echo "empty raw Helm arguments must not yield a supplied Helm argument" >&2
    exit 1
  fi
done

smoke_rendered="$(helm template opencrane-smoke "$CHART_DIR" \
  --namespace opencrane-develop-smoke \
  --values "$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml" \
  --set-string 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32' \
  --set-string 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32' \
  --set-string historyStore.kurrentdb.tls.existingSecret=smoke-kurrent-tls \
  --set-string historyStore.kurrentdb.bootstrapAdmin.existingSecret=smoke-kurrent-admin \
  --set-string historyStore.kurrentdb.bootstrapOps.existingSecret=smoke-kurrent-ops \
  --set-string historyStore.kurrentdb.serviceCredential.existingSecret=smoke-kurrent-service \
  --set-string historyStore.kurrentdb.bootstrap.image.repository=registry.invalid/kurrent-bootstrap \
  --set-string historyStore.kurrentdb.bootstrap.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set-string agentSandbox.namespace=opencrane-develop-smoke \
  --set-string agentSandbox.serviceAccountName=smoke-agent-sandbox \
  --set-string 'agentSandbox.profiles[0].image.repository=registry.invalid/conversation-computer' \
  --set-string 'agentSandbox.profiles[0].image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')"
printf '%s\n' "$smoke_rendered" | node -e '
  const assert = require("node:assert/strict");
  const resources = require(process.argv[1]).loadAll(require("node:fs").readFileSync(0, "utf8"));
  function resource(kind, name) {
    const match = resources.find(function _FindResource(item) { return item?.kind === kind && item.metadata?.name === name; });
    assert.ok(match, `The smoke profile is missing ${kind}/${name}`);
    return match;
  }
  resource("ServiceAccount", "opencrane-smoke-kurrentdb");
  resource("Service", "opencrane-smoke-kurrentdb");
  resource("Job", "opencrane-smoke-kurrentdb-bootstrap");
  const database = resource("StatefulSet", "opencrane-smoke-kurrentdb").spec.template.spec.containers[0];
  assert.equal(database.image, "docker.kurrent.io/kurrent-latest/kurrentdb@sha256:e5c9d59716174a4a47f9d54d6ce45aaaca48114b7ee668135aeb9f16934d74c8");
  for (const name of ["KURRENTDB_INSECURE", "KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS", "KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS"]) {
    assert.equal(database.env.find(function _FindFlag(item) { return item.name === name; })?.value, "false");
  }
  for (const probe of [database.readinessProbe, database.livenessProbe]) {
    assert.equal(probe.httpGet.path, "/health/live");
    assert.equal(probe.httpGet.scheme, "HTTPS");
    assert.deepEqual(probe.httpGet.httpHeaders ?? [], []);
  }
  assert.equal(resource("SandboxTemplate", "opencrane-smoke-developer-template").spec.podTemplate.spec.runtimeClassName, "opencrane-smoke-runc");
  assert.equal(resource("SandboxWarmPool", "developer-pool").spec.replicas, 0);
  const server = resource("Deployment", "opencrane-smoke-opencrane-server").spec.template.spec.containers[0];
  for (const name of ["OPENCRANE_HISTORY_STORE_ENDPOINT", "OPENCRANE_HISTORY_STORE_CA_CERTIFICATE_PATH", "OPENCRANE_HISTORY_STORE_USERNAME_PATH", "OPENCRANE_HISTORY_STORE_PASSWORD_PATH", "OPENCRANE_COMPUTER_PROFILE_REVISION_ID", "OPENCRANE_COMPUTER_NAMESPACE"]) {
    assert.ok(server.env.find(function _FindInput(item) { return item.name === name; })?.value, `The smoke server requires ${name}`);
  }
' "$ROOT_DIR/node_modules/js-yaml"

wrapper_test_dir="$(mktemp -d)"
trap 'cleanup_current_chart_sources; rm -rf "$wrapper_test_dir"' EXIT
mkdir -p "$wrapper_test_dir/platform" "$wrapper_test_dir/bin"
cp "$DEPLOY_SCRIPT" "$wrapper_test_dir/deploy.sh"
cat >"$wrapper_test_dir/platform/k8s-deploy.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$WRAPPER_ARGS_FILE"
exit "${WRAPPER_CORE_EXIT_CODE:-0}"
EOF
cat >"$wrapper_test_dir/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$wrapper_test_dir/platform/k8s-deploy.sh" "$wrapper_test_dir/bin/kubectl"
wrapper_args_file="$wrapper_test_dir/args"
PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY=absent-key \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv4 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client >/dev/null
wrapper_args="$(tr '\n' ' ' <"$wrapper_args_file")"
[[ "$wrapper_args" == *"--namespace opencrane-testv4 --release opencrane-testv4"* ]]
[[ "$wrapper_args" == *"--cluster-tenant testv4"* ]]
set +e
PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" WRAPPER_CORE_EXIT_CODE=47 \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv4 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client >/dev/null
wrapper_status="$?"
set -e
[[ "$wrapper_status" -eq 47 ]]
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv4 \
    --release shared-release \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client >/dev/null 2>&1; then
  echo "silo wrapper accepted a release name outside its ClusterTenant boundary" >&2
  exit 1
fi

cat >"$wrapper_test_dir/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
if [[ "$1 $2" == "get crd" && "$*" == *jsonpath* ]]; then
  printf '%s' "${AGENT_SANDBOX_V1BETA1_STATE:-true:true}"
fi
if [[ "$1 $2 $3" == "get deployment agent-sandbox-controller" ]]; then
  if [[ "$*" == *'-o json' ]]; then
    [[ "${AGENT_SANDBOX_READ_FAILURE:-false}" != true ]] || exit 1
    cat "$AGENT_SANDBOX_DEPLOYMENT_FIXTURE"
  else
    printf '%s\n' 'registry.invalid/agent-sandbox-controller@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  fi
fi
if [[ "$*" == *"jsonpath={.immutable}"* ]]; then
  printf '%s' "${KURRENTDB_SECRET_IMMUTABLE:-true}"
fi
if [[ "$*" == *'jsonpath={.data.username}'* ]]; then
  printf '%s' "${KURRENTDB_SERVICE_USERNAME_BASE64:-b3BlbmNyYW5lLWhpc3Rvcnk=}"
fi
if [[ "$*" == *'go-template='* && "$*" != *"$MISSING_KURRENTDB_SECRET_KEY"* ]]; then
  printf '%s' 'present'
fi
EOF
chmod +x "$wrapper_test_dir/bin/kubectl"

export AGENT_SANDBOX_DEPLOYMENT_FIXTURE="$wrapper_test_dir/agent-sandbox-deployment.json"
cat >"$wrapper_test_dir/agent-sandbox-ready.json" <<'EOF'
{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"agent-sandbox-controller"},"spec":{"template":{"spec":{"containers":[{"name":"manager","image":"registry.invalid/agent-sandbox-controller@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","args":["--leader-elect=true","--extensions"]}]}}}}
EOF
cp "$wrapper_test_dir/agent-sandbox-ready.json" "$AGENT_SANDBOX_DEPLOYMENT_FIXTURE"

testv5_required_args=(
  --kurrentdb-image-digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  --kurrentdb-tls-secret kurrentdb-tls
  --kurrentdb-bootstrap-admin-secret kurrentdb-bootstrap
  --kurrentdb-bootstrap-ops-secret kurrentdb-bootstrap-ops
  --kurrentdb-service-credential-secret kurrentdb-history-service
  --kurrentdb-bootstrap-image-repository registry.invalid/opencrane-kurrentdb-bootstrap
  --kurrentdb-bootstrap-image-digest sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  --kurrentdb-bootstrap-image-pull-policy IfNotPresent
  --kurrentdb-bootstrap-cpu-request 50m
  --kurrentdb-bootstrap-memory-request 64Mi
  --kurrentdb-bootstrap-cpu-limit 100m
  --kurrentdb-bootstrap-memory-limit 128Mi
  --kurrentdb-bootstrap-active-deadline-seconds 330
  --kurrentdb-bootstrap-backoff-limit 0
  --kurrentdb-bootstrap-timeout-seconds 300
  --agent-sandbox-image-repository registry.invalid/opencrane-conversation-computer
  --agent-sandbox-image-digest sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  --agent-sandbox-image-pull-policy IfNotPresent)
PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY=absent-key \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv5 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    "${testv5_required_args[@]}" >/dev/null
testv5_forwarded_args="$(tr '\n' ' ' <"$wrapper_args_file")"
[[ "$testv5_forwarded_args" == *'historyStore.kurrentdb.bootstrapOps.existingSecret=kurrentdb-bootstrap-ops'* ]]
[[ "$testv5_forwarded_args" == *'historyStore.kurrentdb.serviceCredential.existingSecret=kurrentdb-history-service'* ]]
[[ "$testv5_forwarded_args" == *'historyStore.kurrentdb.bootstrap.image.repository=registry.invalid/opencrane-kurrentdb-bootstrap'* ]]
[[ "$testv5_forwarded_args" == *'historyStore.kurrentdb.bootstrap.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'* ]]
[[ "$testv5_forwarded_args" == *'historyStore.kurrentdb.bootstrap.backoffLimit=0'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.enabled=true'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.namespace=opencrane-testv5'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.runtimeClassName=gvisor'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.serviceAccountName=opencrane-testv5-agent-sandbox'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.profiles[0].name=developer'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.profiles[0].poolName=developer-pool'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.profiles[0].warmReplicas=1'* ]]
[[ "$testv5_forwarded_args" == *'agentSandbox.profiles[0].image.digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'* ]]

# The actual wrapper accepts the exact argument in Deployment JSON, never substrings or scalar text.
for mutation in \
  'malformed-json' \
  'del(.spec.template.spec.containers[0].args)' \
  '.spec.template.spec.containers[0].args = []' \
  '.spec.template.spec.containers[0].args = ["--extensions=false"]' \
  '.spec.template.spec.containers[0].args = ["--extensions-extra"]' \
  '.spec.template.spec.containers[0].args = "--extensions"' \
  '.spec.template.spec.containers[0].args = ["--leader-elect=true\n--extensions"]'; do
  if [[ "$mutation" == malformed-json ]]; then
    printf '{invalid' >"$AGENT_SANDBOX_DEPLOYMENT_FIXTURE"
  else
    jq "$mutation" "$wrapper_test_dir/agent-sandbox-ready.json" >"$AGENT_SANDBOX_DEPLOYMENT_FIXTURE"
  fi
  rm -f "$wrapper_args_file"
  if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY=absent-key \
    bash "$wrapper_test_dir/deploy.sh" \
      --base-domain dev.opencrane.ai --cluster-tenant testv5 \
      --acme-email operator@example.com --first-user-email owner@example.com \
      --oidc-issuer-url https://issuer.example.com/ --oidc-client-id test-client \
      "${testv5_required_args[@]}" >/dev/null 2>"$wrapper_test_dir/extensions.error"; then
    echo "testv5 accepted invalid Sandbox arguments: $mutation" >&2
    exit 1
  fi
  grep -Fq 'requires the Agent Sandbox extensions reconciler' "$wrapper_test_dir/extensions.error"
  [[ ! -e "$wrapper_args_file" ]] || { echo 'Invalid Sandbox arguments reached the deploy core.' >&2; exit 1; }
done
cp "$wrapper_test_dir/agent-sandbox-ready.json" "$AGENT_SANDBOX_DEPLOYMENT_FIXTURE"
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" AGENT_SANDBOX_READ_FAILURE=true \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai --cluster-tenant testv5 \
    --acme-email operator@example.com --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ --oidc-client-id test-client \
    "${testv5_required_args[@]}" >/dev/null 2>"$wrapper_test_dir/extensions-read.error"; then
  echo 'testv5 ignored a failed Sandbox Deployment read.' >&2
  exit 1
fi
grep -Fq 'could not read the Agent Sandbox controller Deployment' "$wrapper_test_dir/extensions-read.error"
[[ ! -e "$wrapper_args_file" ]] || { echo 'A failed Sandbox read reached the deploy core.' >&2; exit 1; }

testv5_immutable_error_file="$wrapper_test_dir/testv5-kurrentdb-immutable.error"
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY=absent-key KURRENTDB_SECRET_IMMUTABLE=false \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv5 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    "${testv5_required_args[@]}" > /dev/null 2>"$testv5_immutable_error_file"; then
  echo "testv5 accepted a mutable KurrentDB Secret" >&2
  exit 1
fi
grep -Fq 'must set immutable: true' "$testv5_immutable_error_file"

testv5_service_username_error_file="$wrapper_test_dir/testv5-kurrentdb-service-username.error"
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY=absent-key KURRENTDB_SERVICE_USERNAME_BASE64=b3RoZXItdXNlcg== \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv5 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    "${testv5_required_args[@]}" > /dev/null 2>"$testv5_service_username_error_file"; then
  echo "testv5 accepted a KurrentDB service credential for another username" >&2
  exit 1
fi
grep -Fq "must use username 'opencrane-history'" "$testv5_service_username_error_file"

for missing_kurrentdb_secret_key in tls.crt tls.key ca.crt password username; do
  testv5_error_file="$wrapper_test_dir/testv5-$missing_kurrentdb_secret_key.error"
  if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" MISSING_KURRENTDB_SECRET_KEY="$missing_kurrentdb_secret_key" \
    bash "$wrapper_test_dir/deploy.sh" \
      --base-domain dev.opencrane.ai \
      --cluster-tenant testv5 \
      --acme-email operator@example.com \
      --first-user-email owner@example.com \
      --oidc-issuer-url https://issuer.example.com/ \
      --oidc-client-id test-client \
      "${testv5_required_args[@]}" > /dev/null 2>"$testv5_error_file"; then
    echo "testv5 accepted KurrentDB Secret without '$missing_kurrentdb_secret_key'" >&2
    exit 1
  fi
  grep -Fq "requires key '$missing_kurrentdb_secret_key'" "$testv5_error_file"
done

testv5_version_error_file="$wrapper_test_dir/testv5-agent-sandbox-version.error"
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" AGENT_SANDBOX_V1BETA1_STATE='true:false' \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv5 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    "${testv5_required_args[@]}" > /dev/null 2>"$testv5_version_error_file"; then
  echo "testv5 accepted an Agent Sandbox CRD without v1beta1 storage" >&2
  exit 1
fi
grep -Fq "to serve and store v1beta1 resources" "$testv5_version_error_file"

provider_secret_calls=()
kubectl()
{
  provider_secret_calls+=("$*")
  if [[ "$1 $2" == "get secret" ]]; then
    return 0
  fi
  return 0
}
source "$PROVIDER_SECRET_HELPER"
ensure_provider_key_secrets "opencrane-testv2"
if printf '%s\n' "${provider_secret_calls[@]}" | grep -Fq 'create secret'; then
  echo "provider placeholder creation overwrites an existing BYOK Secret" >&2
  exit 1
fi

echo "silo deploy profile contract: PASS"
