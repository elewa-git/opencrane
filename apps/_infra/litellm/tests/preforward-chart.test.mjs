import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseAllDocuments } from 'yaml';

const chartSources = fileURLToPath(new URL('../../deploy-k8s/platform/current-chart-sources.sh', import.meta.url));
const contract = 'opencrane.preforward-rate-limit.v1';
const digest = `sha256:${'a'.repeat(64)}`;
const qualified = [
    '--set-string', `litellm.preforwardRejectionContract=${contract}`,
    '--set-string', 'litellm.image.repository=ghcr.io/elewa-git/opencrane-litellm',
    '--set-string', `litellm.image.digest=${digest}`,
];

/** Render the current complete composer without writing dependency archives into the checkout. */
function render(flags)
{
    return spawnSync('bash', ['-c',
        'set -euo pipefail; source "$1"; shift; prepare_current_chart_sources; trap cleanup_current_chart_sources EXIT; helm template acme "$(current_chart_sources_dir)" --namespace acme "$@"',
        'preforward-chart', chartSources,
        '--set-string', 'memoryGateway.kubernetesApiServerCidrs[0]=10.43.0.1/32',
        '--set-string', 'memoryGateway.kubernetesApiServerEndpointCidrs[0]=172.18.0.2/32',
        ...flags,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
}

for (const [name, flags, enabled] of [['default', [], false], ['qualified owned digest', qualified, true]])
{
    test(`renders ${name} with matching proxy image and server proof configuration`, () =>
    {
        const result = render(flags);
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        const documents = parseAllDocuments(result.stdout).map(document =>
        {
            assert.equal(document.errors.length, 0);
            return document.toJS();
        });
        const deployment = component => documents.find(document => document?.kind === 'Deployment'
            && document.metadata.labels?.['app.kubernetes.io/component'] === component);
        const server = deployment('opencrane-server').spec.template.spec.containers[0];
        const env = server.env.filter(entry => entry.name.startsWith('LITELLM_PREFORWARD_'));
        assert.deepEqual(env, enabled ? [
            { name: 'LITELLM_PREFORWARD_CONTRACT', value: contract },
            { name: 'LITELLM_PREFORWARD_ENDPOINT', value: 'http://acme-opencrane-litellm:4000' },
        ] : []);
        assert.equal(deployment('litellm').spec.template.spec.containers[0].image,
            enabled ? `ghcr.io/elewa-git/opencrane-litellm@${digest}` : 'ghcr.io/berriai/litellm-non_root:main-v1.81.0-stable');
    });
}

for (const [name, flags, error] of [
    ['shared endpoint', ['--set', 'sharedPlatform.litellm.mode=shared'], 'managed release-local'],
    ['disabled proxy', ['--set', 'litellm.enabled=false'], 'managed release-local'],
    ['custom image', ['--set-string', 'litellm.image.repository=example.test/custom/proxy'], 'OpenCrane-owned'],
    ['unknown contract', ['--set-string', 'litellm.preforwardRejectionContract=other'], 'supported contract'],
    ['missing digest', ['--set-string', 'litellm.image.digest='], 'published image digest'],
    ['invalid digest', ['--set-string', 'litellm.image.digest=latest'], 'published image digest'],
])
{
    test(`rejects qualified ${name} in the actual composer`, () =>
    {
        const result = render([...qualified, ...flags]);
        assert.ifError(result.error);
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes(error), result.stderr);
    });
}
