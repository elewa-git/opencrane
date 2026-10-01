import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseAllDocuments } from 'yaml';

/** Checks rendered workload identity without querying or changing a cluster. */
export function assertWorkloadIdentity(documents, name, namespace, enabled)
{
    const owned = documents.filter(document => document?.metadata?.name === name);
    const accounts = owned.filter(document => document.kind === 'ServiceAccount');
    const deployments = owned.filter(document => document.kind === 'Deployment');
    assert.equal(accounts.length, enabled ? 1 : 0, 'Expected the release-local service account only in managed mode');
    assert.equal(deployments.length, enabled ? 1 : 0, 'Expected the release-local deployment only in managed mode');
    if (!enabled)
        return;
    const account = accounts[0];
    const pod = deployments[0].spec.template.spec;
    assert.equal(account.metadata.namespace, namespace);
    assert.equal(account.automountServiceAccountToken, false);
    assert.equal(pod.serviceAccountName, name);
    assert.equal(pod.automountServiceAccountToken, false);
    assert.ok(!(pod.volumes ?? []).some(volume => volume.projected?.sources?.some(source => source.serviceAccountToken)), 'LiteLLM must not receive a projected Kubernetes API token');
    for (const document of documents)
    {
        if (document?.kind !== 'RoleBinding' && document?.kind !== 'ClusterRoleBinding')
            continue;
        for (const subject of document.subjects ?? [])
        {
            const matches = subject.kind === 'ServiceAccount' && subject.name === name && (subject.namespace ?? document.metadata?.namespace ?? namespace) === namespace
                || subject.kind === 'User' && subject.name === `system:serviceaccount:${namespace}:${name}`
                || subject.kind === 'Group' && ['system:authenticated', 'system:serviceaccounts', `system:serviceaccounts:${namespace}`].includes(subject.name);
            assert.ok(!matches, 'Rendered RBAC must not grant LiteLLM Kubernetes API access');
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
    const [file, name, namespace, mode] = process.argv.slice(2);
    assert.ok(file && name && namespace && ['managed', 'absent'].includes(mode), 'Expected manifest, workload name, namespace and managed/absent mode');
    const documents = parseAllDocuments(readFileSync(file, 'utf8')).map(document =>
    {
        assert.equal(document.errors.length, 0, 'Rendered manifest must be valid YAML');
        return document.toJS();
    });
    assertWorkloadIdentity(documents, name, namespace, mode === 'managed');
}
