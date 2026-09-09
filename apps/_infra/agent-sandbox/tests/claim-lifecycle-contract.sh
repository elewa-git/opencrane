#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SMOKE="$ROOT_DIR/apps/_infra/agent-sandbox/tests/claim-lifecycle-smoke.sh"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
mkdir -p "$FIXTURE_DIR/bin"
export FIXTURE_DIR
cat > "$FIXTURE_DIR/bin/kubectl" <<'SH'
#!/usr/bin/env bash
exec node "$FIXTURE_DIR/kubectl.cjs" "$@"
SH
cat > "$FIXTURE_DIR/kubectl.cjs" <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const scenario = process.env.FIXTURE_SCENARIO;
const directory = process.env.FIXTURE_DIR;
fs.appendFileSync(`${directory}/calls`, `${args.join(' ')}\n`);
const names = { namespace: 'smoke', claim: 'computer-controller-proof-g1', service: 'controller-proof-service' };
const labels = { 'opencrane.ai/computer-id': 'computer-controller-proof', 'opencrane.ai/computer-generation': '1', 'opencrane.ai/computer-lease-id': 'lease-controller-proof' };
const claimOwner = { apiVersion: 'extensions.agents.x-k8s.io/v1beta1', kind: 'SandboxClaim', name: names.claim, uid: 'fixture-claim-uid', controller: true };
const sandboxOwner = { apiVersion: 'agents.x-k8s.io/v1beta1', kind: 'Sandbox', name: names.claim, uid: 'fixture-sandbox-uid', controller: true };
if (args.includes('--as')) {
  assert.equal(args[args.indexOf('--as') + 1], 'system:serviceaccount:smoke:smoke-opencrane-server');
  assert.deepEqual(args.flatMap((argument, index) => argument === '--as-group' ? [args[index + 1]] : []).sort(),
    ['system:authenticated', 'system:serviceaccounts', 'system:serviceaccounts:smoke']);
}
if (args.includes('auth')) {
  assert(args.includes('--as'));
  assert.equal(args[args.indexOf('auth') + 1], 'can-i');
  const verb = args[args.indexOf('can-i') + 1];
  const resource = args[args.indexOf('can-i') + 2];
  const namespace = args[args.indexOf('-n') + 1];
  assert(['smoke', 'kube-system'].includes(namespace));
  assert.equal(resource, ['get', 'update', 'patch', 'delete'].includes(verb) ? `pods/${names.claim}` : 'pods');
  assert(namespace !== 'smoke' || verb !== 'get');
  const grant = namespace === 'smoke' && (
    scenario === `server-pod-${verb}-granted` ||
    scenario === 'server-group-pod-list-granted' && verb === 'list' && args.includes('system:serviceaccounts:smoke')) ||
    namespace === 'kube-system' && scenario === 'foreign-pod-read-granted' && verb === 'get';
  if (scenario === 'pod-authorization-error') {
    process.stderr.write('The API server could not evaluate the authorization request.\n');
    process.exit(1);
  }
  process.stdout.write(grant ? 'yes\n' : 'no\n');
  process.exit(grant ? 0 : 1);
} else if (args.includes('create')) {
  assert(args.includes('--as'));
  assert(!args.some(argument => argument.startsWith('--dry-run')));
  const claim = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.deepEqual(claim.spec.additionalPodMetadata.labels, labels);
  assert.equal(claim.spec.warmPoolRef.name, 'developer-pool');
  claim.metadata.uid = 'fixture-claim-uid';
  fs.writeFileSync(`${directory}/claim.json`, JSON.stringify(claim));
  if (scenario === 'existing') {
    process.stderr.write('AlreadyExists\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(claim));
} else if (args.includes('get')) {
  const resource = args[args.indexOf('get') + 1];
  if (resource === `sandboxclaim/${names.claim}`) {
    const claim = JSON.parse(fs.readFileSync(`${directory}/claim.json`, 'utf8'));
    claim.metadata.annotations['agents.x-k8s.io/controller-first-observed-at'] = '2026-09-08T12:00:00Z';
    claim.status = { sandbox: { name: names.claim }, conditions: [{ type: 'Ready', status: 'False', reason: 'PodNotReady' }] };
    if (scenario === 'invalid-metadata') {
      claim.status = { sandbox: {}, conditions: [{ type: 'Ready', status: 'False', reason: 'InvalidMetadata', message: 'opencrane.ai is not in the allowlist' }] };
    }
    process.stdout.write(JSON.stringify(claim));
  } else if (resource === `sandbox/${names.claim}`) {
    if (scenario === 'foreign-owner') claimOwner.uid = 'another-claim-uid';
    process.stdout.write(JSON.stringify({
      apiVersion: 'agents.x-k8s.io/v1beta1', kind: 'Sandbox',
      metadata: { name: names.claim, namespace: names.namespace, uid: 'fixture-sandbox-uid', ownerReferences: [claimOwner] },
      spec: { podTemplate: { metadata: { labels } } },
      status: { service: names.service, serviceFQDN: `${names.service}.${scenario === 'foreign-address' ? 'other' : names.namespace}.svc.cluster.local` }
    }));
  } else if (resource === `pod/${names.claim}`) {
    assert(args.includes('--as'));
    if (scenario === 'server-pod-read-denied') {
      process.stderr.write('Forbidden: the server cannot get the named Pod.\n');
      process.exit(1);
    }
    if (scenario === 'missing-pod') process.exit(0);
    if (scenario === 'wrong-pod-lease') labels['opencrane.ai/computer-lease-id'] = 'another-lease';
    process.stdout.write(JSON.stringify({
      metadata: { name: names.claim, namespace: names.namespace, ownerReferences: [sandboxOwner], labels: { ...labels, 'app.kubernetes.io/component': scenario === 'wrong-network-selector' ? 'foreign' : 'agent-sandbox' } },
      spec: { serviceAccountName: 'smoke-agent-sandbox', runtimeClassName: 'opencrane-smoke-runc', dnsPolicy: scenario === 'public-dns' ? 'None' : 'ClusterFirst', ...(scenario === 'injected-dns' ? { dnsConfig: { nameservers: ['8.8.8.8'] } } : {}) },
      status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }] }
    }));
  } else if (resource === 'networkpolicy/smoke-developer-template-network-policy') {
    if (scenario === 'upstream-policy') process.stdout.write(resource);
  } else if (resource === 'service/smoke-litellm') {
    process.stdout.write('4100');
  } else {
    throw new Error(`Unexpected read: ${resource}`);
  }
} else if (args.includes('exec')) {
  assert(args.includes('python3'));
  assert(args.includes('--container=conversation-computer'));
  const script = fs.readFileSync(0, 'utf8');
  assert(script.includes('socket.getaddrinfo'));
  assert(script.includes('socket.create_connection'));
  assert(args.includes('smoke-litellm.smoke.svc.cluster.local'));
  assert(args.includes('4100'));
  if (scenario === 'dns-unreachable' || scenario === 'model-unreachable') process.exit(1);
} else if (args.includes('delete')) {
  assert(args.includes('--as'));
  assert.equal(args[args.indexOf('--raw') + 1], `/apis/extensions.agents.x-k8s.io/v1beta1/namespaces/smoke/sandboxclaims/${names.claim}`);
  const options = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.deepEqual(options, { apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Foreground', preconditions: { uid: 'fixture-claim-uid' } });
  fs.writeFileSync(`${directory}/deleted`, 'yes');
  process.stdout.write('{}');
} else if (args.includes('wait')) {
  assert(args.includes('--for=delete'));
  assert(fs.existsSync(`${directory}/deleted`));
  if (scenario === 'cleanup-blocked') process.exit(1);
} else {
  throw new Error(`Unexpected command: ${args.join(' ')}`);
}
NODE
chmod +x "$FIXTURE_DIR/bin/kubectl"

bash -n "$SMOKE"
: > "$FIXTURE_DIR/calls"
PATH="$FIXTURE_DIR/bin:$PATH" FIXTURE_SCENARIO=healthy bash "$SMOKE" k3d-contract smoke smoke 5 > "$FIXTURE_DIR/healthy.log"
grep -Fq 'Sandbox controller lifecycle: PASS' "$FIXTURE_DIR/healthy.log"
grep -Fq 'get sandbox/computer-controller-proof-g1' "$FIXTURE_DIR/calls"
grep -Fq 'get pod/computer-controller-proof-g1' "$FIXTURE_DIR/calls"
grep -Fq 'auth can-i list pods -n smoke' "$FIXTURE_DIR/calls"
grep -Fq 'auth can-i create pods -n smoke' "$FIXTURE_DIR/calls"
grep -Fq 'auth can-i delete pods/computer-controller-proof-g1 -n smoke' "$FIXTURE_DIR/calls"
grep -Fq 'auth can-i get pods/computer-controller-proof-g1 -n kube-system' "$FIXTURE_DIR/calls"
grep -Fq 'wait --for=delete sandbox/computer-controller-proof-g1 pod/computer-controller-proof-g1' "$FIXTURE_DIR/calls"
grep -Fq 'wait --for=delete service/controller-proof-service' "$FIXTURE_DIR/calls"
[[ "$(grep -c ' delete --raw ' "$FIXTURE_DIR/calls")" == 1 ]]

for scenario in invalid-metadata foreign-owner wrong-pod-lease foreign-address public-dns injected-dns wrong-network-selector dns-unreachable model-unreachable upstream-policy missing-pod cleanup-blocked existing server-pod-read-denied; do
  : > "$FIXTURE_DIR/calls"
  rm -f "$FIXTURE_DIR/deleted"
  if PATH="$FIXTURE_DIR/bin:$PATH" FIXTURE_SCENARIO="$scenario" bash "$SMOKE" k3d-contract smoke smoke 1 > "$FIXTURE_DIR/$scenario.log" 2>&1; then
    printf 'Controller smoke accepted invalid scenario: %s\n' "$scenario" >&2
    exit 1
  fi
  if [[ "$scenario" == existing ]]; then
    ! grep -q ' delete --raw ' "$FIXTURE_DIR/calls"
  else
    grep -q ' delete --raw ' "$FIXTURE_DIR/calls"
  fi
  ! grep -Fq 'Sandbox controller lifecycle: PASS' "$FIXTURE_DIR/$scenario.log"
done
grep -Fq 'InvalidMetadata' "$FIXTURE_DIR/invalid-metadata.log"
grep -Fq 'Forbidden: the server cannot get the named Pod.' "$FIXTURE_DIR/server-pod-read-denied.log"

for scenario in server-pod-list-granted server-pod-watch-granted server-pod-create-granted server-pod-update-granted server-pod-patch-granted server-pod-delete-granted server-pod-deletecollection-granted foreign-pod-read-granted server-group-pod-list-granted pod-authorization-error; do
  : > "$FIXTURE_DIR/calls"
  if PATH="$FIXTURE_DIR/bin:$PATH" FIXTURE_SCENARIO="$scenario" bash "$SMOKE" k3d-contract smoke smoke 1 > "$FIXTURE_DIR/$scenario.log" 2>&1; then
    printf 'Controller smoke accepted invalid Pod authorization: %s\n' "$scenario" >&2
    exit 1
  fi
  ! grep -Eq ' (create -f|delete --raw) ' "$FIXTURE_DIR/calls"
  grep -Fq 'Expected the server to be denied' "$FIXTURE_DIR/$scenario.log"
  ! grep -Fq 'Sandbox controller lifecycle: PASS' "$FIXTURE_DIR/$scenario.log"
done

: > "$FIXTURE_DIR/calls"
if PATH="$FIXTURE_DIR/bin:$PATH" bash "$SMOKE" shared-production smoke smoke > "$FIXTURE_DIR/context.log" 2>&1; then
  echo 'Controller fixture accepted a non-disposable context.' >&2
  exit 1
fi
[[ ! -s "$FIXTURE_DIR/calls" ]]
printf 'Sandbox controller lifecycle contract: PASS\n'
