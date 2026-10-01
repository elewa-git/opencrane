#!/usr/bin/env bash
set -euo pipefail

trap '_contract_status=$?; printf "hosted generated-file platform contract failed at line %s\n" "$LINENO" >&2; exit "$_contract_status"' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
FIXTURE_DIR="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/fixtures/hosted-generated-file"
SMOKE="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh"
VALUES="$ROOT_DIR/apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml"
REGISTRY_FIXTURE="$FIXTURE_DIR/registry-fixture.sh"
PROTOCOL_SERVICE="$FIXTURE_DIR/protocol-service.sh"
RUNNER="$FIXTURE_DIR/run-qualification.sh"

bash -n "$SMOKE" "$FIXTURE_DIR"/*.sh
node --test "$FIXTURE_DIR/protocol-fixture.test.mjs"
node --test "$FIXTURE_DIR/collect-evidence.test.mjs"
node --test "$FIXTURE_DIR/server-trust-contract.test.mjs"

grep -Fq 'https://hosted-generated-file-registry.${namespace}.svc:443' "$REGISTRY_FIXTURE"
grep -Fq 'ca_file: "/etc/rancher/k3s/hosted-generated-file/ca.crt"' "$REGISTRY_FIXTURE"
grep -Fq '{ name: REGISTRY_AUTH, value: htpasswd }' "$REGISTRY_FIXTURE"
grep -Fq '{ name: REGISTRY_HTTP_TLS_CERTIFICATE, value: /tls/server.crt }' "$REGISTRY_FIXTURE"
grep -Fq 'clusterIP: ${HOSTED_REGISTRY_SERVICE_IP}' "$REGISTRY_FIXTURE"
grep -Fq '_write_state HOSTED_EVIDENCE_KEY_PATH "$RUN_DIR/evidence-key"' "$REGISTRY_FIXTURE"
grep -Fq '{ name: model, port: 4000, targetPort: model }' "$PROTOCOL_SERVICE"
grep -Fq -- '--from-file=evidence-key="$HOSTED_EVIDENCE_KEY_PATH"' "$PROTOCOL_SERVICE"
grep -Fq 'PUBLIC_UPSTREAM_MARKER = "opencrane-hosted-fixture-public-marker"' "$FIXTURE_DIR/protocol-fixture.mjs"
grep -Fq 'name: hosted-generated-file-litellm-provider' "$PROTOCOL_SERVICE"
grep -Fq 'ports: [{ protocol: TCP, port: 4000 }]' "$PROTOCOL_SERVICE"
grep -Fq -- '--registry-config "$HOSTED_K3S_REGISTRY_CONFIG_PATH"' "$SMOKE"
grep -Fq -- '--host-alias "${HOSTED_REGISTRY_SERVICE_IP}:' "$SMOKE"
grep -Fq -- '--volume "${HOSTED_CA_PATH}:/etc/rancher/k3s/hosted-generated-file/ca.crt@all"' "$SMOKE"

for endpoint in '/.well-known/openid-configuration' '/authorize' '/token' '/userinfo' '/jwks' '/v1/chat/completions' '/__fixture/evidence'; do
  grep -Fq "$endpoint" "$FIXTURE_DIR/protocol-fixture.mjs"
done
grep -Fq 'offeredName = input.tools[0]?.function?.name' "$FIXTURE_DIR/protocol-fixture.mjs"
grep -Fq 'name: offeredName' "$FIXTURE_DIR/protocol-fixture.mjs"
grep -Fq 'code_challenge_method !== "S256"' "$FIXTURE_DIR/protocol-fixture.mjs"
if rg -n --pcre2 '^import .* from "(?!node:)' "$FIXTURE_DIR/protocol-fixture.mjs"; then
  echo "Hosted protocol fixture imports a product or third-party owner" >&2
  exit 1
fi

for project in agent-controller artifact-scanner mcp-executor skill-authoring; do
  grep -Fq "\"${project}|opencrane/${project}:develop-smoke" "$SMOKE"
done
grep -Fq 'apps/mcp-file-generator/deploy/Dockerfile' "$FIXTURE_DIR/prepare-oci-archive.sh"
grep -Fq -- '--output "type=oci,dest=${oci_tar}"' "$FIXTURE_DIR/prepare-oci-archive.sh"
grep -Fq 'application/zip' "$ROOT_DIR/apps/opencrane/src/bootstrap/conversations/__tests__/hosted-generated-file/hosted-generated-file-client.ts"

grep -Fq 'artifactScanner:' "$VALUES"
grep -Fq 'agentController:' "$VALUES"
grep -Fq 'opencrane-mcp-executor:' "$VALUES"
grep -Fq 'additionalCaCertificates:' "$VALUES"
grep -Fq 'existingSecret: hosted-generated-file-ca' "$VALUES"
grep -Fq 'existingSecret: hosted-generated-file-registry-authorization' "$VALUES"
grep -Fq 'mode: instance' "$VALUES"
grep -Fq '{ name: HOSTED_FIXTURE_UPSTREAM_MODEL, value: hosted-generated-file }' "$PROTOCOL_SERVICE"

grep -Fq 'OPENCRANE_HOSTED_QUALIFICATION_BASE_TRANSPORT_ADDRESS=127.0.0.1' "$RUNNER"
grep -Fq 'OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL=$OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL' "$RUNNER"
grep -Fq 'EXPECTED_CONTEXT="k3d-${CLUSTER_NAME}"' "$RUNNER"
grep -Fq 'kubectl config current-context' "$RUNNER"
grep -Fq 'service/${POOLER_SERVICE}' "$RUNNER"
grep -Fq 'APPLICATION_SECRET="${POSTGRES_RELEASE}-opencrane-app"' "$RUNNER"
grep -Fq 'unset OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL' "$RUNNER"
grep -Fq '_run_cli prepare' "$RUNNER"
grep -Fq '_run_cli validate' "$RUNNER"
grep -Fq '_run_cli qualify' "$RUNNER"
grep -Fq '_restart_owned_workloads' "$RUNNER"
grep -Fq '_run_cli verify' "$RUNNER"
grep -Fq '.modelRequestCount == 2' "$RUNNER"
grep -Fq '.toolResponseCount == 1' "$RUNNER"
grep -Fq '.continuationResponseCount == 1' "$RUNNER"
grep -Fq 'HOSTED_EVIDENCE_KEY_PATH' "$RUNNER"
grep -Fq 'OPENCRANE_HOSTED_QUALIFICATION_NAMESPACE=$NAMESPACE' "$RUNNER"
if rg -n 'HOSTED_LITELLM_MASTER_KEY_PATH|HOSTED_UPSTREAM_KEY_PATH|HOSTED_FIXTURE_UPSTREAM_KEY|OPENCRANE_HOSTED_QUALIFICATION_(UPSTREAM|PROVIDER).*KEY|upstream-key' "$FIXTURE_DIR" "$RUNNER"; then
  echo "Hosted qualification retained a confidential provider key or arbitrary key forwarding" >&2
  exit 1
fi
if rg -n '/key/(generate|delete)' "$FIXTURE_DIR/protocol-fixture.mjs"; then
  echo "Hosted protocol fixture retained LiteLLM administration routes" >&2
  exit 1
fi
if rg -n 'mode: shared|hosted-generated-file-litellm' "$VALUES" "$SMOKE"; then
  echo "Hosted smoke retained shared LiteLLM fixture state" >&2
  exit 1
fi

COLLISION_TEST_DIR="$(mktemp -d)"
COLLISION_MOCK_BIN="$COLLISION_TEST_DIR/bin"
COLLISION_RUN_DIR="$COLLISION_TEST_DIR/run"
mkdir -p "$COLLISION_MOCK_BIN"
cat > "$COLLISION_MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' invoked > "$COLLISION_DOCKER_CAPTURE"
exit 1
EOF
chmod +x "$COLLISION_MOCK_BIN/docker"
if COLLISION_DOCKER_CAPTURE="$COLLISION_TEST_DIR/docker-capture" PATH="$COLLISION_MOCK_BIN:$PATH" bash "$REGISTRY_FIXTURE" prepare "$COLLISION_RUN_DIR" collision-cluster "$ROOT_DIR" collision.opencrane.test requester@collision.opencrane.test collision >"$COLLISION_TEST_DIR/output" 2>&1; then
  echo "Hosted registry fixture accepted colliding Owner and requester identities" >&2
  exit 1
fi
grep -Fq 'Owner and requester must be different fixture identities' "$COLLISION_TEST_DIR/output"
[[ ! -e "$COLLISION_RUN_DIR" && ! -e "$COLLISION_TEST_DIR/docker-capture" ]]
rm -rf -- "$COLLISION_TEST_DIR"

TEST_DIR="$(mktemp -d)"
MOCK_BIN="$TEST_DIR/bin"
RUNNER_ROOT="$TEST_DIR/repository"
CAPTURE="$TEST_DIR/capture"
mkdir -p "$MOCK_BIN" "$RUNNER_ROOT/dist/apps/opencrane/hosted-generated-file" "$TEST_DIR/run/evidence"
trap 'rm -rf -- "$TEST_DIR"' EXIT
ln -s "$ROOT_DIR/package.json" "$RUNNER_ROOT/package.json"
printf '%s\n' 'certificate' > "$TEST_DIR/ca.crt"
printf '%s\n' 'fixture-key' > "$TEST_DIR/key"
cat > "$TEST_DIR/run/hosted-services.env" <<EOF
HOSTED_CA_PATH='$TEST_DIR/ca.crt'
HOSTED_PROTOCOL_TRANSPORT_URL='https://127.0.0.1:19443'
HOSTED_PROTOCOL_URL='https://hosted-generated-file-protocol.opencrane-develop-smoke.svc:9443'
HOSTED_OIDC_SUBJECT='subject'
HOSTED_OIDC_EMAIL='owner@develop-smoke.opencrane.test'
HOSTED_OWNER_OIDC_SUBJECT='owner-subject'
HOSTED_OWNER_OIDC_EMAIL='owner@develop-smoke.opencrane.test'
HOSTED_EVIDENCE_PATH='$TEST_DIR/run/evidence/hosted-generated-file.json'
HOSTED_EVIDENCE_KEY_PATH='$TEST_DIR/key'
EOF
printf '%s\n' '{"archivePath":"/archive.zip","expectedCsvPath":"/expected.csv"}' > "$TEST_DIR/run/oci-archive-evidence.json"
cat > "$MOCK_BIN/helm" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == status ]]; then printf '%s\n' '{"info":{"status":"deployed"}}'; exit 0; fi
if [[ "$1" == get && "$2" == metadata ]]; then
  if [[ "$3" == *-postgres ]]; then chart=postgres; else chart=opencrane-silo; fi
  printf '{"chart":"%s","version":"%s"}\n' "$chart" "$MOCK_VERSION"
  exit 0
fi
exit 1
EOF
cat > "$MOCK_BIN/kubectl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == 'config current-context' ]]; then printf '%s\n' "${MOCK_CONTEXT:-k3d-opencrane-develop-smoke}"; exit 0; fi
if [[ "$*" == *'get service'* ]]; then printf '%s' opencrane-smoke-postgres; exit 0; fi
if [[ "$*" == *'get secret opencrane-smoke-postgres-opencrane-app'* ]]; then printf '%s' cG9zdGdyZXNxbDovL29wZW5jcmFuZTpwcml2YXRlLXNlY3JldEBpbnRlcm5hbDo1NDMyL29wZW5jcmFuZQ==; exit 0; fi
if [[ "$*" == *'get secret opencrane-smoke-clustertenant-tls'* ]]; then printf '%s' Y2VydGlmaWNhdGU=; exit 0; fi
if [[ "$*" == *'get deployment'* ]]; then
  if [[ "$*" == *component* ]]; then
    [[ "$*" == *artifact-service* ]] && printf '%s' artifact-service || printf '%s' opencrane-server
  elif [[ "$*" == *managed-by* ]]; then
    printf '%s' Helm
  elif [[ "$*" == *release-namespace* ]]; then
    printf '%s' opencrane-develop-smoke
  else
    printf '%s' "${MOCK_DEPLOYMENT_INSTANCE:-opencrane-smoke}"
  fi
  exit 0
fi
if [[ "$*" == *'get pods'* ]]; then
  if [[ "${POD_MODE:-}" == stuck || ! -f "$POD_STATE" ]]; then
    printf '%s' prior-pod
  else
    pod_polls="$(<"$POD_POLLS")"
    pod_polls="$((pod_polls + 1))"
    printf '%s' "$pod_polls" > "$POD_POLLS"
    if (( pod_polls <= 2 )); then printf '%s' prior-pod; else printf '%s' replacement-pod; fi
  fi
  exit 0
fi
if [[ "$*" == *'port-forward'* ]]; then
  trap 'printf "%s\\n" forward-cleaned >> "$CAPTURE"; exit 0' TERM
  printf '%s\n' 'Forwarding from 127.0.0.1:55433 -> 5432'
  while true; do sleep 1; done
fi
if [[ "$*" == *'rollout restart'* ]]; then : > "$POD_STATE"; printf '%s' 0 > "$POD_POLLS"; printf '%s\n' "$*" >> "$CAPTURE"; exit 0; fi
if [[ "$*" == *'rollout status'* ]]; then printf '%s\n' "$*" >> "$CAPTURE"; exit 0; fi
exit 1
EOF
cat > "$MOCK_BIN/openssl" <<'EOF'
#!/usr/bin/env bash
cat
EOF
cat > "$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"modelRequestCount":2,"toolResponseCount":1,"continuationResponseCount":1}'
EOF
cat > "$RUNNER_ROOT/dist/apps/opencrane/hosted-generated-file/hosted-generated-file-cli.js" <<'EOF'
import { appendFileSync } from "node:fs";
const database = process.env.OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL === undefined ? "none" : "private";
if (process.env.OPENCRANE_HOSTED_QUALIFICATION_NAMESPACE !== "opencrane-develop-smoke") process.exit(9);
appendFileSync(process.env.CAPTURE, `${process.argv[2]}:${database}\n`);
if (process.argv[2] === "qualify" && process.env.MOCK_CLI_FAILURE === "1") process.exit(7);
EOF
chmod +x "$MOCK_BIN"/*
if CAPTURE="$CAPTURE" POD_STATE="$TEST_DIR/pods" POD_POLLS="$TEST_DIR/pod-polls" MOCK_CLI_FAILURE=1 MOCK_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")" OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=smoke PATH="$MOCK_BIN:$PATH" bash "$RUNNER" "$RUNNER_ROOT" "$TEST_DIR/run" opencrane-develop-smoke opencrane-smoke smoke.develop-smoke.opencrane.test 10 opencrane-develop-smoke >"$TEST_DIR/output" 2>&1; then
  echo "Hosted runner accepted a failing qualification child" >&2
  exit 1
fi
grep -Fxq 'prepare:private' "$CAPTURE"
grep -Fxq 'validate:none' "$CAPTURE"
grep -Fxq 'qualify:private' "$CAPTURE"
if grep -Fq 'verify:' "$CAPTURE"; then
  echo "Hosted runner verified after a failed qualification child" >&2
  exit 1
fi
if grep -Fq 'private-secret' "$TEST_DIR/output"; then
  echo "Hosted runner exposed the disposable database credential" >&2
  exit 1
fi
for _attempt in {1..10}; do
  grep -Fxq forward-cleaned "$CAPTURE" && break
  sleep 0.1
done
grep -Fxq forward-cleaned "$CAPTURE"
SUCCESS_CAPTURE="$TEST_DIR/success-capture"
if ! CAPTURE="$SUCCESS_CAPTURE" POD_STATE="$TEST_DIR/success-pods" POD_POLLS="$TEST_DIR/success-pod-polls" MOCK_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")" OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=smoke PATH="$MOCK_BIN:$PATH" bash "$RUNNER" "$RUNNER_ROOT" "$TEST_DIR/run" opencrane-develop-smoke opencrane-smoke smoke.develop-smoke.opencrane.test 10 opencrane-develop-smoke >"$TEST_DIR/success-output" 2>&1; then
  echo "Hosted runner rejected a complete restart and verification" >&2
  exit 1
fi
grep -Fxq 'verify:none' "$SUCCESS_CAPTURE"
[[ "$(<"$TEST_DIR/success-pod-polls")" -ge 4 ]]
TIMEOUT_CAPTURE="$TEST_DIR/timeout-capture"
if CAPTURE="$TIMEOUT_CAPTURE" POD_STATE="$TEST_DIR/timeout-pods" POD_POLLS="$TEST_DIR/timeout-pod-polls" POD_MODE=stuck MOCK_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")" OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=smoke PATH="$MOCK_BIN:$PATH" bash "$RUNNER" "$RUNNER_ROOT" "$TEST_DIR/run" opencrane-develop-smoke opencrane-smoke smoke.develop-smoke.opencrane.test 1 opencrane-develop-smoke >"$TEST_DIR/timeout-output" 2>&1; then
  echo "Hosted runner accepted a restart whose prior pods remained" >&2
  exit 1
fi
grep -Fq "Prior 'opencrane-server' pods did not exit after restart" "$TEST_DIR/timeout-output"
if grep -Fq 'verify:' "$TIMEOUT_CAPTURE"; then
  echo "Hosted runner verified before prior pods exited" >&2
  exit 1
fi
WRONG_CONTEXT_CAPTURE="$TEST_DIR/wrong-context-capture"
if CAPTURE="$WRONG_CONTEXT_CAPTURE" POD_STATE="$TEST_DIR/wrong-context-pods" POD_POLLS="$TEST_DIR/wrong-context-pod-polls" MOCK_CONTEXT=other-cluster MOCK_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")" OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=smoke PATH="$MOCK_BIN:$PATH" bash "$RUNNER" "$RUNNER_ROOT" "$TEST_DIR/run" opencrane-develop-smoke opencrane-smoke smoke.develop-smoke.opencrane.test 10 opencrane-develop-smoke >"$TEST_DIR/wrong-context-output" 2>&1; then
  echo "Hosted runner accepted the wrong Kubernetes context" >&2
  exit 1
fi
grep -Fq "Current context does not match disposable cluster" "$TEST_DIR/wrong-context-output"
[[ ! -e "$WRONG_CONTEXT_CAPTURE" ]]
WRONG_DEPLOYMENT_CAPTURE="$TEST_DIR/wrong-deployment-capture"
if CAPTURE="$WRONG_DEPLOYMENT_CAPTURE" POD_STATE="$TEST_DIR/wrong-deployment-pods" POD_POLLS="$TEST_DIR/wrong-deployment-pod-polls" MOCK_DEPLOYMENT_INSTANCE=foreign-release MOCK_VERSION="$(jq -r '.version' "$ROOT_DIR/package.json")" OPENCRANE_HOSTED_QUALIFICATION_SILO_ID=smoke PATH="$MOCK_BIN:$PATH" bash "$RUNNER" "$RUNNER_ROOT" "$TEST_DIR/run" opencrane-develop-smoke opencrane-smoke smoke.develop-smoke.opencrane.test 10 opencrane-develop-smoke >"$TEST_DIR/wrong-deployment-output" 2>&1; then
  echo "Hosted runner accepted a foreign deployment restart target" >&2
  exit 1
fi
grep -Fq "Deployment 'opencrane-smoke-opencrane-server' is not owned" "$TEST_DIR/wrong-deployment-output"
if grep -Fq 'rollout restart' "$WRONG_DEPLOYMENT_CAPTURE"; then
  echo "Hosted runner restarted a foreign deployment" >&2
  exit 1
fi
if rg -n 'NODE_TLS_REJECT_UNAUTHORIZED|http://hosted-generated-file-registry|OciImageValidationState.*Imported|workflow.*register|start.*worker|fake.*scan' "$FIXTURE_DIR" "$SMOKE"; then
  echo "Hosted qualification fixture contains a forbidden bypass or workflow owner" >&2
  exit 1
fi

grep -Fq 'publicModelName: "hosted-generated-file-model", upstreamModel: "openai/hosted-generated-file"' "$ROOT_DIR/apps/opencrane/src/bootstrap/conversations/__tests__/hosted-generated-file/hosted-generated-file-client.ts"
grep -Fq 'opencrane-hosted-fixture-public-marker' "$ROOT_DIR/apps/opencrane/src/bootstrap/conversations/__tests__/hosted-generated-file/hosted-generated-file-client.ts"
grep -Fq 'hosted-generated-file-protocol.${namespace}.svc:4000/v1' "$ROOT_DIR/apps/opencrane/src/bootstrap/conversations/__tests__/hosted-generated-file/hosted-generated-file-cli.ts"
grep -Fq 'const namespace = _Namespace(_Required(environment, "NAMESPACE"));' "$ROOT_DIR/apps/opencrane/src/bootstrap/conversations/__tests__/hosted-generated-file/hosted-generated-file-cli.ts"

echo "hosted generated-file platform contract: PASS"
