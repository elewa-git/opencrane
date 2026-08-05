import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';

const [, , ingressPath, certManagerPath, cnpgPath] = process.argv;

function loadDocuments(path)
{
  return YAML.parseAllDocuments(fs.readFileSync(path, 'utf8'))
    .map((document) => document.toJSON())
    .filter((document) => document?.kind);
}

function fail(message)
{
  throw new Error(message);
}

function findResource(documents, kind, name)
{
  const resource = documents.find((candidate) => (
    candidate.kind === kind && candidate.metadata?.name === name
  ));
  return resource ?? fail(`missing ${kind}/${name}`);
}

function workloadPodSpec(resource)
{
  return resource.spec?.template?.spec ?? fail(
    `${resource.kind}/${resource.metadata?.name} has no pod spec`,
  );
}

function primaryContainer(resource)
{
  const podSpec = workloadPodSpec(resource);
  return podSpec.containers?.[0] ?? fail(
    `${resource.kind}/${resource.metadata?.name} has no primary container`,
  );
}

function assertSingleReplica(resource)
{
  if (resource.spec?.replicas !== 1) {
    fail(`${resource.kind}/${resource.metadata?.name} must have one replica`);
  }
}

function assertRequests(resource, cpu, memory)
{
  const requests = primaryContainer(resource).resources?.requests;
  if (requests?.cpu !== cpu || requests?.memory !== memory) {
    fail(`${resource.kind}/${resource.metadata?.name} has unexpected resource requests`);
  }
}

function assertHardened(resource, requirePodSecurity = true)
{
  const podSpec = workloadPodSpec(resource);
  const podSecurity = podSpec.securityContext ?? {};
  const containerSecurity = primaryContainer(resource).securityContext ?? {};
  const droppedCapabilities = containerSecurity.capabilities?.drop ?? [];

  if (requirePodSecurity
    && (podSecurity.runAsNonRoot !== true || podSecurity.seccompProfile?.type !== 'RuntimeDefault')) {
    fail(`${resource.kind}/${resource.metadata?.name} has an incomplete pod security context`);
  }
  if (containerSecurity.allowPrivilegeEscalation !== false
    || (containerSecurity.runAsNonRoot !== true && podSecurity.runAsNonRoot !== true)
    || !droppedCapabilities.includes('ALL')) {
    fail(`${resource.kind}/${resource.metadata?.name} has an incomplete container security context`);
  }
}

function assertClusterScopedInventory(documents, expectedEnvironmentKey)
{
  const clusterScopedKinds = new Set([
    'ClusterRole',
    'ClusterRoleBinding',
    'CustomResourceDefinition',
    'IngressClass',
    'MutatingWebhookConfiguration',
    'ValidatingWebhookConfiguration',
  ]);
  const actual = documents
    .filter((resource) => clusterScopedKinds.has(resource.kind) && !resource.metadata?.namespace)
    .map((resource) => {
      const resourceKind = resource.kind === 'CustomResourceDefinition'
        ? 'crd'
        : resource.kind.toLowerCase();
      return `${resourceKind}/${resource.metadata.name}`;
    })
    .sort();
  const expected = (process.env[expectedEnvironmentKey] ?? '')
    .split('\n')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${expectedEnvironmentKey} does not match the complete rendered cluster-scoped inventory`);
  }
}

const ingress = loadDocuments(ingressPath);
const certManager = loadDocuments(certManagerPath);
const cnpg = loadDocuments(cnpgPath);

assertClusterScopedInventory(ingress, 'OPENCRANE_EXPECTED_INGRESS_CLUSTER_RESOURCES');
assertClusterScopedInventory(certManager, 'OPENCRANE_EXPECTED_CERT_MANAGER_CLUSTER_RESOURCES');
assertClusterScopedInventory(cnpg, 'OPENCRANE_EXPECTED_CNPG_CLUSTER_RESOURCES');

const ingressController = findResource(ingress, 'Deployment', 'ingress-nginx-controller');
assertSingleReplica(ingressController);
assertRequests(ingressController, '100m', '90Mi');
assertHardened(ingressController);

const ingressService = findResource(ingress, 'Service', 'ingress-nginx-controller');
if (ingressService.spec?.loadBalancerIP !== '35.205.225.244') {
  fail('ingress Service does not bind the reserved address');
}
for (const jobName of ['ingress-nginx-admission-create', 'ingress-nginx-admission-patch']) {
  const job = findResource(ingress, 'Job', jobName);
  assertRequests(job, '10m', '20Mi');
  // The upstream Job chart exposes container security only. Assert every exposed
  // control without pretending a pod-level value can be configured here.
  assertHardened(job, false);
}
if (ingress.some((resource) => resource.metadata?.name.includes('defaultbackend'))) {
  fail('disabled ingress default backend rendered unexpectedly');
}
if (ingress.some((resource) => resource.metadata?.name === 'ingress-nginx-controller-metrics')) {
  fail('disabled ingress metrics Service rendered unexpectedly');
}

for (const deploymentName of ['cert-manager', 'cert-manager-webhook', 'cert-manager-cainjector']) {
  const deployment = findResource(certManager, 'Deployment', deploymentName);
  assertSingleReplica(deployment);
  assertRequests(deployment, '10m', '32Mi');
  assertHardened(deployment);
}
for (const deploymentName of ['cert-manager', 'cert-manager-cainjector']) {
  const args = primaryContainer(findResource(certManager, 'Deployment', deploymentName)).args ?? [];
  if (!args.includes('--leader-election-namespace=cert-manager')) {
    fail(`${deploymentName} does not keep leader election out of GKE-managed kube-system`);
  }
}
const startupApiCheck = findResource(certManager, 'Job', 'cert-manager-startupapicheck');
assertRequests(startupApiCheck, '10m', '32Mi');
assertHardened(startupApiCheck);
const certManagerArgs = primaryContainer(
  findResource(certManager, 'Deployment', 'cert-manager'),
).args ?? [];
for (const expectedArg of [
  '--acme-http01-solver-resource-request-cpu=10m',
  '--acme-http01-solver-resource-request-memory=32Mi',
  '--acme-http01-solver-resource-limits-memory=64Mi',
]) {
  if (!certManagerArgs.includes(expectedArg)) {
    fail(`cert-manager controller is missing ${expectedArg}`);
  }
}
if (certManager.some((resource) => ['PodMonitor', 'ServiceMonitor'].includes(resource.kind))) {
  fail('disabled cert-manager monitoring resource rendered unexpectedly');
}

const cnpgController = findResource(cnpg, 'Deployment', 'cloudnative-pg');
assertSingleReplica(cnpgController);
assertRequests(cnpgController, '100m', '100Mi');
assertHardened(cnpgController);
if (cnpg.some((resource) => ['PodMonitor', 'ServiceMonitor'].includes(resource.kind))) {
  fail('disabled CloudNativePG monitoring resource rendered unexpectedly');
}
