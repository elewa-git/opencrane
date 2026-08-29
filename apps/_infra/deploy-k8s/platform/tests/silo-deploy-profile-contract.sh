#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/apps/_infra/deploy-k8s/deploy.sh"
DEVELOP_SMOKE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh"
MODEL_HELPER="$ROOT_DIR/apps/_infra/deploy-k8s/platform/initial-model-provider.sh"
COGNEE_POLICY="$ROOT_DIR/apps/_infra/cognee/deploy/image-policy.sh"

source "$ROOT_DIR/apps/_infra/deploy-k8s/platform/current-chart-sources.sh"
ensure_umbrella_chart_dependencies

grep -Fq -- '--acme-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--first-user-email' "$DEPLOY_SCRIPT"
grep -Fq -- '--initial-model-provider' "$DEPLOY_SCRIPT"
grep -Fq -- '--postgres-admin-credentials-secret opencrane-admin-postgres-bootstrap' "$DEPLOY_SCRIPT"
grep -Fq -- '--opencrane-ui-digest sha256:REVIEWED_BROWSER_BUILD_DIGEST' "$DEPLOY_SCRIPT"
grep -Fq -- '--cognee-digest sha256:REVIEWED_COGNEE_BUILD_DIGEST' "$DEPLOY_SCRIPT"
grep -Fq -- 'Fresh silo deploys require `--opencrane-ui-digest` and `--cognee-digest`' "$DEPLOY_SCRIPT"
grep -Fq -- 'OPENCRANE_INITIAL_MODEL_API_KEY' "$DEPLOY_SCRIPT"
grep -Fq -- 'validate_initial_model_provider' "$MODEL_HELPER"
grep -Fq -- 'publish_initial_model_provider_secret' "$MODEL_HELPER"
grep -Fq -- 'append_initial_model_provider_helm_args' "$MODEL_HELPER"
grep -Fq -- '--from-file=apiKey=<(printf' "$MODEL_HELPER"
if grep -Fq -- '--from-literal=apiKey="$api_key"' "$MODEL_HELPER"; then
  echo "initial model provider key is exposed through kubectl command arguments" >&2
  exit 1
fi
grep -Fq -- 'ACME_EMAIL="${OPENCRANE_ACME_EMAIL:-}"' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_ISSUER_URL="$2"; PASSTHROUGH+=(--oidc-issuer-url "$2")' "$DEPLOY_SCRIPT"
grep -Fq -- 'OIDC_CLIENT_ID="$2"; PASSTHROUGH+=(--oidc-client-id "$2")' "$DEPLOY_SCRIPT"
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
grep -Fq -- 'TOOL_RUNNER_NAMESPACE="${RELEASE}-tools"' "$DEPLOY_CORE"
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
grep -Fq -- '--set-string "opencrane-tool-runner.toolRunner.namespace=$TOOL_RUNNER_NAMESPACE"' "$DEPLOY_CORE"
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
cognee_deployment="$(helm template opencrane-silo "$ROOT_DIR/apps/_infra/deploy-k8s" \
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
local_cognee_deployment="$(helm template opencrane-silo "$ROOT_DIR/apps/_infra/deploy-k8s" \
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

wrapper_test_dir="$(mktemp -d)"
trap 'rm -rf "$wrapper_test_dir"' EXIT
mkdir -p "$wrapper_test_dir/platform" "$wrapper_test_dir/bin"
cp "$DEPLOY_SCRIPT" "$wrapper_test_dir/deploy.sh"
cat >"$wrapper_test_dir/platform/k8s-deploy.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$WRAPPER_ARGS_FILE"
EOF
cat >"$wrapper_test_dir/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$wrapper_test_dir/platform/k8s-deploy.sh" "$wrapper_test_dir/bin/kubectl"
wrapper_args_file="$wrapper_test_dir/args"
PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv4 \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    --initial-model-provider openai >/dev/null
wrapper_args="$(tr '\n' ' ' <"$wrapper_args_file")"
[[ "$wrapper_args" == *"--namespace opencrane-testv4 --release opencrane-testv4"* ]]
if PATH="$wrapper_test_dir/bin:$PATH" WRAPPER_ARGS_FILE="$wrapper_args_file" \
  bash "$wrapper_test_dir/deploy.sh" \
    --base-domain dev.opencrane.ai \
    --cluster-tenant testv4 \
    --release shared-release \
    --acme-email operator@example.com \
    --first-user-email owner@example.com \
    --oidc-issuer-url https://issuer.example.com/ \
    --oidc-client-id test-client \
    --initial-model-provider openai >/dev/null 2>&1; then
  echo "silo wrapper accepted a release name outside its ClusterTenant boundary" >&2
  exit 1
fi

provider_secret_calls=()
kubectl()
{
  provider_secret_calls+=("$*")
  if [[ "$1 $2" == "get secret" ]]; then
    return 0
  fi
  return 0
}
source "$MODEL_HELPER"
ensure_provider_key_secrets "opencrane-testv2"
if printf '%s\n' "${provider_secret_calls[@]}" | grep -Fq 'create secret'; then
  echo "provider placeholder creation overwrites an existing BYOK Secret" >&2
  exit 1
fi

echo "silo deploy profile contract: PASS"
