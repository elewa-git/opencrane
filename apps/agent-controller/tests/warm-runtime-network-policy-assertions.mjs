import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';

import YAML from 'yaml';

const [, , manifestPath] = process.argv;
assert.ok(manifestPath, 'warm-runtime policy assertions require a rendered manifest');

const documents = YAML.parseAllDocuments(fs.readFileSync(manifestPath, 'utf8'))
  .map((document) => document.toJSON())
  .filter((document) => document?.kind);

const poolProfiles = [
  {
    claimedProfile: 'personal',
    name: 'personal-warm',
    namespace: 'oc-opencrane-runtime',
  },
  {
    claimedProfile: 'managed',
    name: 'managed-warm',
    namespace: 'oc-managed-warm-custom',
  },
];

function renderedNamespace(document)
{
  return document.metadata?.namespace ?? 'server-ns';
}

function findNetworkPolicy(name, namespace, component)
{
  const matches = documents.filter((document) => (
    document.apiVersion === 'networking.k8s.io/v1'
      && document.kind === 'NetworkPolicy'
      && document.metadata?.name === name
      && renderedNamespace(document) === namespace
  ));
  assert.equal(matches.length, 1, `expected one NetworkPolicy/${namespace}/${name}`);
  assert.equal(
    matches[0].metadata?.labels?.['app.kubernetes.io/component'],
    component,
    `NetworkPolicy/${namespace}/${name} has the wrong component owner`,
  );
  return matches[0];
}

function findAdmissionPolicy(nameSuffix, namespace)
{
  const bindings = documents.filter((document) => (
    document.apiVersion === 'admissionregistration.k8s.io/v1'
      && document.kind === 'ValidatingAdmissionPolicyBinding'
      && document.metadata?.name?.endsWith(nameSuffix)
      && document.spec?.policyName === document.metadata.name
      && document.spec?.matchResources?.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] === namespace
  ));
  assert.equal(
    bindings.length,
    1,
    `expected one ${namespace} ValidatingAdmissionPolicyBinding ending in ${nameSuffix}`,
  );
  assert.deepStrictEqual(bindings[0].spec.validationActions, ['Deny']);
  const matches = documents.filter((document) => (
    document.apiVersion === 'admissionregistration.k8s.io/v1'
      && document.kind === 'ValidatingAdmissionPolicy'
      && document.metadata?.name === bindings[0].spec.policyName
  ));
  assert.equal(matches.length, 1, `expected the bound ValidatingAdmissionPolicy/${bindings[0].spec.policyName}`);
  return matches[0];
}

function normalizeExpression(expression)
{
  return expression.replace(/\s+/gu, ' ').trim();
}

function allowsWarmMutation({
  claimedProfile,
  expectedPool,
  hash = '7f4b8d9c6a',
  immutableUpdate = true,
  newProfile,
  oldProfile = 'generic',
  operation,
  ownerApiVersion = 'apps/v1',
  ownerBlockDeletion = true,
  ownerController = true,
  ownerCount = 1,
  ownerKind = 'ReplicaSet',
  ownerName,
  poolLabel,
  username,
})
{
  const agentController = 'system:serviceaccount:server-ns:agent-controller';
  const replicaSetController = 'system:serviceaccount:kube-system:replicaset-controller';
  const identityAllows = (
    (operation === 'UPDATE' && username === agentController)
      || (operation === 'DELETE' && (
        username === agentController
          || (username === replicaSetController && oldProfile === 'generic')
      ))
  );
  const ownerAllows = (
    poolLabel === expectedPool
      && ownerCount === 1
      && ownerController
      && ownerBlockDeletion
      && ownerApiVersion === 'apps/v1'
      && ownerKind === 'ReplicaSet'
      && ownerName === `${expectedPool}-${hash}`
  );
  const updateAllows = (
    immutableUpdate
      && oldProfile === 'generic'
      && (newProfile ?? claimedProfile) === claimedProfile
  );
  return identityAllows && ownerAllows && (operation === 'DELETE' || updateAllows);
}

function releasePodLabels(component)
{
  return {
    'app.kubernetes.io/name': 'opencrane',
    'app.kubernetes.io/instance': 'oc',
    'app.kubernetes.io/component': component,
  };
}

function sameReleasePeer(component)
{
  return {
    namespaceSelector: {
      matchLabels: { 'kubernetes.io/metadata.name': 'server-ns' },
    },
    podSelector: {
      matchLabels: releasePodLabels(component),
    },
  };
}

function findNamespace(name)
{
  const matches = documents.filter((document) => (
    document.apiVersion === 'v1'
      && document.kind === 'Namespace'
      && document.metadata?.name === name
  ));
  assert.equal(matches.length, 1, `expected one Namespace/${name}`);
  return matches[0];
}

const runtimeReleaseLabels = new Set(poolProfiles.map((pool) => (
  findNamespace(pool.namespace).metadata?.labels?.['opencrane.ai/runtime-release']
)));
assert.equal(runtimeReleaseLabels.size, 1, 'warm runtime namespaces must share one release label');
const [runtimeReleaseLabel] = runtimeReleaseLabels;
assert.match(runtimeReleaseLabel ?? '', /^[a-f0-9]{32}$/u, 'warm runtime release label is malformed');

function claimedRuntimePeer(pool)
{
  return {
    namespaceSelector: {
      matchLabels: {
        'kubernetes.io/metadata.name': pool.namespace,
        'opencrane.ai/runtime-release': runtimeReleaseLabel,
      },
    },
    podSelector: {
      matchLabels: {
        'app.kubernetes.io/component': 'warm-runtime',
        'opencrane.ai/warm-runtime-pool': `oc-opencrane-${pool.name}`,
        'opencrane.ai/warm-runtime-profile': pool.claimedProfile,
      },
    },
  };
}

function runtimeServerPeer(pool)
{
  return {
    namespaceSelector: {
      matchLabels: {
        'kubernetes.io/metadata.name': pool.namespace,
        'opencrane.ai/runtime-release': runtimeReleaseLabel,
      },
    },
    podSelector: {
      matchLabels: {
        'app.kubernetes.io/component': 'warm-runtime',
        'opencrane.ai/warm-runtime-pool': `oc-opencrane-${pool.name}`,
      },
    },
  };
}

function dnsEgress()
{
  return {
    to: [{
      namespaceSelector: {
        matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' },
      },
      podSelector: {
        matchLabels: { 'k8s-app': 'kube-dns' },
      },
    }],
    ports: [
      { port: 53, protocol: 'UDP' },
      { port: 53, protocol: 'TCP' },
    ],
  };
}

function nodeLocalDnsEgress()
{
	return {
		to: [{ ipBlock: { cidr: '169.254.20.10/32' } }],
		ports: [
			{ port: 53, protocol: 'UDP' },
			{ port: 53, protocol: 'TCP' },
		],
	};
}

function componentEgress(component, port)
{
  return {
    to: [sameReleasePeer(component)],
    ports: [{ port, protocol: 'TCP' }],
  };
}

function portOnlyEgress(port, protocol)
{
  return { ports: [{ protocol, port }] };
}

function controllerIngress()
{
  return {
    from: [sameReleasePeer('agent-controller')],
    ports: [{ port: 8090, protocol: 'TCP' }],
  };
}

function rulesOnPort(rules, port)
{
  return (rules ?? []).filter((rule) => (
    rule.ports?.some((candidate) => candidate.port === port)
  ));
}

for (const pool of poolProfiles) {
  const policyPrefix = `oc-opencrane-${pool.name}`;
  const podPool = `oc-opencrane-${pool.name}`;
  const genericPolicy = findNetworkPolicy(`${policyPrefix}-generic`, pool.namespace, 'warm-runtime');
  const claimedPolicy = findNetworkPolicy(`${policyPrefix}-claimed`, pool.namespace, 'warm-runtime');
  const admissionPolicy = findAdmissionPolicy(`-${pool.name}-warm`, pool.namespace);
  const admissionPolicyName = admissionPolicy.metadata.name;

  assert.equal(admissionPolicy.spec?.failurePolicy, 'Fail');
  assert.equal(admissionPolicy.spec?.matchConditions, undefined);
  assert.equal(admissionPolicy.spec?.matchConstraints?.matchPolicy, 'Exact');
  assert.deepStrictEqual(admissionPolicy.spec?.matchConstraints?.resourceRules, [{
    apiGroups: [''],
    apiVersions: ['v1'],
    operations: ['UPDATE', 'DELETE'],
    resources: ['pods'],
    scope: 'Namespaced',
  }]);
  assert.equal(admissionPolicy.spec?.validations?.length, 3);
  assert.equal(
    normalizeExpression(admissionPolicy.spec.validations[0].expression),
    normalizeExpression(`
      (request.operation == 'UPDATE' &&
       request.userInfo.username == "system:serviceaccount:server-ns:agent-controller") ||
      (request.operation == 'DELETE' &&
       (request.userInfo.username == "system:serviceaccount:server-ns:agent-controller" ||
        (request.userInfo.username == 'system:serviceaccount:kube-system:replicaset-controller' &&
         oldObject.metadata.labels['opencrane.ai/warm-runtime-profile'] == "generic")))
    `),
    `ValidatingAdmissionPolicy/${admissionPolicyName} must separate controller updates from rollout deletes`,
  );
  assert.equal(
    normalizeExpression(admissionPolicy.spec.validations[1].expression),
    normalizeExpression(`
      oldObject.metadata.labels['opencrane.ai/warm-runtime-pool'] == "${podPool}" &&
      oldObject.metadata.ownerReferences.size() == 1 && oldObject.metadata.ownerReferences[0].controller == true
      && oldObject.metadata.ownerReferences[0].blockOwnerDeletion == true
      && oldObject.metadata.ownerReferences[0].apiVersion == 'apps/v1'
      && oldObject.metadata.ownerReferences[0].kind == 'ReplicaSet'
      && 'pod-template-hash' in oldObject.metadata.labels
      && oldObject.metadata.ownerReferences[0].name == "${podPool}-" + oldObject.metadata.labels['pod-template-hash']
    `),
    `ValidatingAdmissionPolicy/${admissionPolicyName} must fence deletes to the fixed Deployment ReplicaSet`,
  );
  assert.equal(
    normalizeExpression(admissionPolicy.spec.validations[2].expression),
    normalizeExpression(`
      request.operation == 'DELETE' ||
      (object.metadata.uid == oldObject.metadata.uid &&
       object.metadata.name == oldObject.metadata.name &&
       object.metadata.namespace == oldObject.metadata.namespace &&
       object.metadata.annotations == oldObject.metadata.annotations &&
       object.metadata.ownerReferences == oldObject.metadata.ownerReferences &&
       object.spec == oldObject.spec && object.status == oldObject.status &&
       oldObject.metadata.labels['opencrane.ai/warm-runtime-profile'] == "generic" &&
       object.metadata.labels['opencrane.ai/warm-runtime-profile'] == "${pool.claimedProfile}" &&
       object.metadata.labels.all(key, key == 'opencrane.ai/warm-runtime-profile' || object.metadata.labels[key] == oldObject.metadata.labels[key]) &&
       oldObject.metadata.labels.all(key, key == 'opencrane.ai/warm-runtime-profile' || object.metadata.labels[key] == oldObject.metadata.labels[key]))
    `),
    `ValidatingAdmissionPolicy/${admissionPolicyName} must preserve exact claim updates and delete-only rollout authority`,
  );

  const baseMutation = {
    claimedProfile: pool.claimedProfile,
    expectedPool: podPool,
    operation: 'DELETE',
    ownerName: `${podPool}-7f4b8d9c6a`,
    poolLabel: podPool,
    username: 'system:serviceaccount:kube-system:replicaset-controller',
  };
  const cases = [
    { expected: true, input: { ...baseMutation }, label: 'ReplicaSet controller deletes a generic rollout Pod' },
    { expected: false, input: { ...baseMutation, oldProfile: pool.claimedProfile }, label: 'ReplicaSet controller cannot delete a claimed Pod' },
    { expected: true, input: { ...baseMutation, oldProfile: pool.claimedProfile, username: 'system:serviceaccount:server-ns:agent-controller' }, label: 'agent controller deletes a claimed Pod' },
    { expected: false, input: { ...baseMutation, username: 'system:serviceaccount:kube-system:default' }, label: 'foreign identity cannot delete a warm Pod' },
    { expected: false, input: { ...baseMutation, poolLabel: 'another-pool' }, label: 'wrong pool label is denied' },
    { expected: false, input: { ...baseMutation, ownerKind: 'Job' }, label: 'wrong owner kind is denied' },
    { expected: false, input: { ...baseMutation, ownerName: `${podPool}-wrong-hash` }, label: 'wrong owner hash is denied' },
    { expected: true, input: { ...baseMutation, operation: 'UPDATE', username: 'system:serviceaccount:server-ns:agent-controller' }, label: 'agent controller claims a generic Pod' },
    { expected: false, input: { ...baseMutation, operation: 'UPDATE' }, label: 'ReplicaSet controller cannot update a warm Pod' },
    { expected: false, input: { ...baseMutation, immutableUpdate: false, operation: 'UPDATE', username: 'system:serviceaccount:server-ns:agent-controller' }, label: 'agent controller cannot combine a claim with another mutation' },
  ];
  for (const scenario of cases) {
    assert.equal(
      allowsWarmMutation(scenario.input),
      scenario.expected,
      `${pool.name}: ${scenario.label}`,
    );
  }

  assert.deepStrictEqual(genericPolicy.spec, {
    podSelector: {
      matchLabels: {
        'opencrane.ai/warm-runtime-pool': podPool,
        'opencrane.ai/warm-runtime-profile': 'generic',
      },
    },
    policyTypes: ['Ingress', 'Egress'],
    ingress: [],
    egress: [
      dnsEgress(),
      nodeLocalDnsEgress(),
      componentEgress('opencrane-server', 8081),
    ],
  }, `NetworkPolicy/${pool.namespace}/${policyPrefix}-generic has unexpected reachability`);

  assert.deepStrictEqual(claimedPolicy.spec, {
    podSelector: {
      matchLabels: {
        'opencrane.ai/warm-runtime-pool': podPool,
        'opencrane.ai/warm-runtime-profile': pool.claimedProfile,
      },
    },
    policyTypes: ['Ingress', 'Egress'],
    ingress: [controllerIngress()],
    egress: [
      dnsEgress(),
      nodeLocalDnsEgress(),
      componentEgress('opencrane-server', 8081),
      componentEgress('litellm', 4000),
    ],
  }, `NetworkPolicy/${pool.namespace}/${policyPrefix}-claimed has unexpected reachability`);

  const defaultDeny = findNetworkPolicy(
    'oc-opencrane-warm-runtime-default-deny',
    pool.namespace,
    'warm-runtime',
  );
  assert.deepStrictEqual(defaultDeny.spec, {
    podSelector: {},
    policyTypes: ['Ingress', 'Egress'],
    ingress: [],
    egress: [],
  }, `NetworkPolicy/${pool.namespace}/oc-opencrane-warm-runtime-default-deny must deny all traffic`);
}

const controllerPolicy = findNetworkPolicy(
  'oc-opencrane-agent-controller',
  'server-ns',
  'agent-controller',
);
assert.deepStrictEqual(controllerPolicy.spec?.podSelector, {
  matchLabels: releasePodLabels('agent-controller'),
}, 'agent-controller NetworkPolicy must select this release');
assert.deepStrictEqual(controllerPolicy.spec?.ingress, [], 'agent-controller must deny ingress');
assert.deepStrictEqual(rulesOnPort(controllerPolicy.spec?.egress, 8081), [{
  to: [sameReleasePeer('opencrane-server')],
  ports: [{ protocol: 'TCP', port: 8081 }],
}], 'agent-controller server egress has the wrong destination');
assert.deepStrictEqual(rulesOnPort(controllerPolicy.spec?.egress, 8090), [{
  to: poolProfiles.map(claimedRuntimePeer),
  ports: [{ protocol: 'TCP', port: 8090 }],
}], 'agent-controller readiness egress must select both claimed pools');

const liteLlmPolicy = findNetworkPolicy(
  'oc-opencrane-warm-runtime-litellm',
  'server-ns',
  'litellm',
);
assert.deepStrictEqual(liteLlmPolicy.spec, {
  podSelector: { matchLabels: releasePodLabels('litellm') },
  policyTypes: ['Ingress'],
  ingress: [{
    from: poolProfiles.map(claimedRuntimePeer),
    ports: [{ protocol: 'TCP', port: 4000 }],
  }],
}, 'warm-runtime LiteLLM ingress must select both claimed pools');

const liteLlmBasePolicy = findNetworkPolicy(
  'oc-opencrane-litellm',
  'server-ns',
  'litellm',
);
assert.deepStrictEqual(liteLlmBasePolicy.spec, {
  podSelector: { matchLabels: releasePodLabels('litellm') },
  policyTypes: ['Ingress', 'Egress'],
  ingress: [{
    from: [
      sameReleasePeer('opencrane-server'),
      sameReleasePeer('cognee'),
    ],
    ports: [{ protocol: 'TCP', port: 4000 }],
  }],
  egress: [
    portOnlyEgress(5432, 'TCP'),
    {
      ports: [
        { protocol: 'UDP', port: 53 },
        { protocol: 'TCP', port: 53 },
      ],
    },
    portOnlyEgress(443, 'TCP'),
  ],
}, 'LiteLLM base policy must preserve exact callers and bounded egress');

const serverPolicy = findNetworkPolicy(
  'oc-opencrane-opencrane-server',
  'server-ns',
  'opencrane-server',
);
assert.deepStrictEqual(serverPolicy.spec?.podSelector, {
  matchLabels: releasePodLabels('opencrane-server'),
}, 'OpenCrane server NetworkPolicy must select this release');
const controllerServerIngress = (serverPolicy.spec?.ingress ?? []).filter((rule) => (
  rule.from?.some((peer) => (
    peer.podSelector?.matchLabels?.['app.kubernetes.io/component'] === 'agent-controller'
  ))
));
assert.deepStrictEqual(controllerServerIngress, [{
  from: [sameReleasePeer('agent-controller')],
  ports: [{ protocol: 'TCP', port: 8081 }],
}], 'OpenCrane server must admit the same-release controller on its internal port');
const runtimeServerIngress = (serverPolicy.spec?.ingress ?? []).filter((rule) => (
  rule.from?.some((peer) => peer.namespaceSelector?.matchLabels?.['opencrane.ai/runtime-release'])
));
assert.deepStrictEqual(runtimeServerIngress, [{
  from: poolProfiles.map(runtimeServerPeer),
  ports: [{ protocol: 'TCP', port: 8081 }],
}], 'OpenCrane server must admit release-labelled warm runtimes on its internal port');

const runtimePolicyInventory = documents
  .filter((document) => (
    document.apiVersion === 'networking.k8s.io/v1'
      && document.kind === 'NetworkPolicy'
      && poolProfiles.some((pool) => pool.namespace === renderedNamespace(document))
  ))
  .map((document) => `${document.metadata.namespace}/${document.metadata.name}`)
  .sort();
const expectedRuntimePolicyInventory = poolProfiles
  .flatMap((pool) => [
    `${pool.namespace}/oc-opencrane-${pool.name}-claimed`,
    `${pool.namespace}/oc-opencrane-${pool.name}-generic`,
    `${pool.namespace}/oc-opencrane-warm-runtime-default-deny`,
  ])
  .sort();
assert.deepStrictEqual(
  runtimePolicyInventory,
  expectedRuntimePolicyInventory,
  'warm runtime namespaces rendered an unexpected allow policy',
);

console.log('warm runtime NetworkPolicy and admission structure: PASS');
