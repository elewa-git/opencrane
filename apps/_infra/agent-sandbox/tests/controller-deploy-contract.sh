#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEPLOY="$ROOT_DIR/apps/_infra/deploy-k8s/platform/deploy-agent-sandbox-controller.sh"
REAL_KUBECTL="$(command -v kubectl)"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
BIN_DIR="$FIXTURE_DIR/bin"
mkdir -p "$BIN_DIR"
CALLS="$FIXTURE_DIR/calls"
export FAKE_CALLS="$CALLS" REAL_KUBECTL FAKE_APPLIED_MANIFEST="$FIXTURE_DIR/applied.yaml"

cat > "$BIN_DIR/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-sandbox-controller
  namespace: agent-sandbox-system
spec:
  selector:
    matchLabels:
      app: agent-sandbox-controller
  template:
    metadata:
      labels:
        app: agent-sandbox-controller
    spec:
      serviceAccountName: agent-sandbox-controller
      containers:
        - name: agent-sandbox-controller
          args:
            - --leader-elect=true
            - --extensions
          image: registry.k8s.io/agent-sandbox/agent-sandbox-controller:v0.5.3
YAML
printf 'curl-output=%s\n' "$output" >> "$FAKE_CALLS"
SH
cat > "$BIN_DIR/shasum" <<'SH'
#!/usr/bin/env bash
if [[ "${FAKE_BAD_HASH:-false}" == "true" ]]; then
  printf '%s  %s\n' bad "$3"
else
  printf '%s  %s\n' e21a561002a800f78d05d45cb80d773f1651ba6cc0e2b6b9d5110846db031c4d "$3"
fi
SH
cat > "$BIN_DIR/kubectl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'kubectl=%s\n' "$*" >> "$FAKE_CALLS"
if [[ "$*" == 'config current-context' ]]; then
  printf '%s\n' "$FAKE_CURRENT_CONTEXT"
elif [[ "$1" == 'kustomize' ]]; then
  exec "$REAL_KUBECTL" "$@"
elif [[ "$*" == *' apply '* ]]; then
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == '-f' ]]; then cp "$2" "$FAKE_APPLIED_MANIFEST"; break; fi
    shift
  done
elif [[ "$*" == *' get crd '* ]]; then
  printf '%s\n' 'v1beta1:true:true'
fi
SH
chmod +x "$BIN_DIR/curl" "$BIN_DIR/shasum" "$BIN_DIR/kubectl"

bash -n "$DEPLOY"
if PATH="$BIN_DIR:$PATH" FAKE_CURRENT_CONTEXT=other "$DEPLOY" --context opencrane-dev 2>/dev/null; then
  echo 'Installer accepted a mismatched current context.' >&2
  exit 1
fi
! grep -Fq ' apply ' "$CALLS"

: > "$CALLS"
PATH="$BIN_DIR:$PATH" FAKE_CURRENT_CONTEXT=opencrane-dev "$DEPLOY" --context opencrane-dev --preflight >/dev/null
manifest_path="$(sed -n 's/^curl-output=//p' "$CALLS")"
[[ ! -e "$(dirname "$manifest_path")" ]]
grep -Fq 'kubectl=kustomize ' "$CALLS"
! grep -Fq ' apply ' "$CALLS"

if PATH="$BIN_DIR:$PATH" FAKE_CURRENT_CONTEXT=opencrane-dev FAKE_BAD_HASH=true "$DEPLOY" --context opencrane-dev --preflight 2>/dev/null; then
  echo 'Installer accepted a manifest checksum mismatch.' >&2
  exit 1
fi

: > "$CALLS"
PATH="$BIN_DIR:$PATH" FAKE_CURRENT_CONTEXT=opencrane-dev "$DEPLOY" --context opencrane-dev >/dev/null
grep -Fq 'kubectl=--context opencrane-dev apply --server-side --field-manager=opencrane-agent-sandbox' "$CALLS"
grep -Fq 'kubectl=--context opencrane-dev rollout status deployment/agent-sandbox-controller --namespace agent-sandbox-system --timeout=180s' "$CALLS"
[[ "$(grep -Fc 'kubectl=--context opencrane-dev get crd ' "$CALLS")" == '4' ]]

# Parse the actual local Kustomize output so a missing mount or broadened allowlist cannot pass.
cd "$ROOT_DIR"
node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const YAML = require('yaml');
const documents = YAML.parseAllDocuments(fs.readFileSync(process.env.FAKE_APPLIED_MANIFEST, 'utf8')).map(document => document.toJSON());
const config = documents.find(document => document.kind === 'ConfigMap');
assert.equal(config.metadata.name, 'opencrane-agent-sandbox-label-domains');
assert.equal(config.metadata.namespace, 'agent-sandbox-system');
assert.deepEqual(config.data, { 'allowed-label-domains': 'opencrane.ai' });
const deployment = documents.find(document => document.kind === 'Deployment');
const pod = deployment.spec.template.spec;
assert.equal(pod.serviceAccountName, 'agent-sandbox-controller');
assert.equal(pod.containers.length, 1);
const container = pod.containers[0];
assert.equal(container.image, 'registry.k8s.io/agent-sandbox/agent-sandbox-controller@sha256:ba381b4e0c86cca597d5c5a31860e38d30ec1c45e0a7a8328bb2799c87d059c0');
assert.deepEqual(container.args, ['--leader-elect=true', '--extensions']);
assert.deepEqual(container.volumeMounts, [{ name: 'opencrane-label-domains', mountPath: '/etc/sandbox-config', readOnly: true }]);
assert.deepEqual(pod.volumes, [{ name: 'opencrane-label-domains', configMap: { name: config.metadata.name, items: [{ key: 'allowed-label-domains', path: 'allowed-label-domains' }] } }]);
NODE

if "$DEPLOY" --context 2>"$FIXTURE_DIR/missing-value"; then
  echo 'Installer accepted --context without a value.' >&2
  exit 1
fi
grep -Fq -- '--context requires a value' "$FIXTURE_DIR/missing-value"

bash "$ROOT_DIR/apps/_infra/agent-sandbox/tests/claim-lifecycle-contract.sh"
echo 'Agent Sandbox controller deploy contract: PASS'
