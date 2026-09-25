import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseAllDocuments } from 'yaml';
import { assertWorkloadIdentity } from './workload-identity.mjs';

const name = 'acme-opencrane-litellm';
const namespace = 'acme';

/** Supplies rendered-resource shapes, not a replacement for the real Helm contract. */
function fixture()
{
    return [
        { kind: 'ServiceAccount', metadata: { name, namespace }, automountServiceAccountToken: false },
        { kind: 'Deployment', metadata: { name, namespace }, spec: { template: { spec: { serviceAccountName: name, automountServiceAccountToken: false } } } },
    ];
}

test('accepts the managed identity without Kubernetes API credentials or grants', () => assertWorkloadIdentity(fixture(), name, namespace, true));
test('accepts no managed resources for shared and disabled modes', () => assertWorkloadIdentity([], name, namespace, false));

for (const [label, change] of [
    ['missing account', documents => documents.shift()],
    ['duplicate account', documents => documents.push(structuredClone(documents[0]))],
    ['wrong account namespace', documents => { documents[0].metadata.namespace = 'other'; }],
    ['account automount enabled', documents => { documents[0].automountServiceAccountToken = true; }],
    ['account automount omitted', documents => { delete documents[0].automountServiceAccountToken; }],
    ['default pod identity', documents => { delete documents[1].spec.template.spec.serviceAccountName; }],
    ['another pod identity', documents => { documents[1].spec.template.spec.serviceAccountName = 'other'; }],
    ['pod automount enabled', documents => { documents[1].spec.template.spec.automountServiceAccountToken = true; }],
    ['pod automount omitted', documents => { delete documents[1].spec.template.spec.automountServiceAccountToken; }],
    ['projected token', documents => { documents[1].spec.template.spec.volumes = [{ projected: { sources: [{ serviceAccountToken: { audience: 'kubernetes' } }] } }]; }],
])
{
    test(`rejects ${label}`, () =>
    {
        const documents = fixture();
        change(documents);
        assert.throws(() => assertWorkloadIdentity(documents, name, namespace, true));
    });
}

for (const kind of ['RoleBinding', 'ClusterRoleBinding'])
{
    for (const subject of [
        { kind: 'ServiceAccount', name, namespace },
        { kind: 'ServiceAccount', name },
        { kind: 'User', name: `system:serviceaccount:${namespace}:${name}` },
        { kind: 'Group', name: 'system:serviceaccounts' },
        { kind: 'Group', name: `system:serviceaccounts:${namespace}` },
        { kind: 'Group', name: 'system:authenticated' },
    ])
    {
        test(`rejects ${kind} granting ${subject.kind}/${subject.name}`, () =>
        {
            const documents = fixture();
            documents.push({ kind, metadata: { name: 'unexpected', namespace }, subjects: [subject] });
            assert.throws(() => assertWorkloadIdentity(documents, name, namespace, true));
        });
    }
}

test('permits unrelated workload grants', () =>
{
    const documents = fixture();
    documents.push({ kind: 'RoleBinding', metadata: { namespace }, subjects: [{ kind: 'ServiceAccount', name: 'memory-gateway', namespace }, { kind: 'ServiceAccount', name, namespace: 'other' }] });
    assertWorkloadIdentity(documents, name, namespace, true);
});

test('rejects leaked managed resources in absent mode', () => assert.throws(() => assertWorkloadIdentity(fixture(), name, namespace, false)));

test('renders the actual app templates in managed, shared and disabled modes', () =>
{
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const directory = mkdtempSync(join(tmpdir(), 'opencrane-litellm-identity-'));
    try
    {
        mkdirSync(join(directory, 'templates'));
        writeFileSync(join(directory, 'Chart.yaml'), 'apiVersion: v2\nname: opencrane\nversion: 0.0.0\n');
        copyFileSync(join(root, 'apps/_infra/deploy-k8s/values.yaml'), join(directory, 'values.yaml'));
        copyFileSync(join(root, 'apps/_infra/deploy-k8s/platform/templates/_helpers.tpl'), join(directory, 'templates/_helpers.tpl'));
        for (const template of ['_serviceaccount.tpl', '_deployment.tpl', '_qualification.tpl'])
            copyFileSync(join(root, 'apps/_infra/litellm/helm/templates', template), join(directory, 'templates', template));
        // The full silo rejects shared LiteLLM while private Cognee is installed. This fixture
        // checks the app's own absence contract without removing or bypassing that product guard.
        writeFileSync(join(directory, 'templates/resources.yaml'), '{{ include "opencrane.litellm.serviceAccount" . }}\n---\n{{ include "opencrane.litellm.deployment" . }}\n');
        for (const [mode, flags, enabled] of [
            ['managed', [], true],
            ['shared', ['--set', 'sharedPlatform.litellm.mode=shared', '--set-string', 'sharedPlatform.litellm.shared.endpoint=http://litellm.shared.svc:4000'], false],
            ['disabled', ['--set', 'litellm.enabled=false'], false],
        ])
        {
            const result = spawnSync('helm', ['template', 'acme', directory, '--namespace', namespace, ...flags], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
            assert.ifError(result.error);
            assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
            const documents = parseAllDocuments(result.stdout).map(document =>
            {
                assert.equal(document.errors.length, 0);
                return document.toJS();
            });
            assertWorkloadIdentity(documents, name, namespace, enabled);
        }
    }
    finally
    {
        rmSync(directory, { recursive: true, force: true });
    }
});
