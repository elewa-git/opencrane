import assert from "node:assert/strict";
import test from "node:test";

import { assertHostedServerTrust } from "./server-trust-contract.mjs";

function _configuredServer()
{
  return {
    kind: "Deployment", metadata: { name: "opencrane-smoke-opencrane-server" },
    spec: { template: {
      metadata: { annotations: { "opencrane.ai/additional-ca-certificates-revision": "hosted-generated-file-v1" } },
      spec: {
        containers: [{ name: "opencrane-ui", env: [{ name: "NODE_EXTRA_CA_CERTS", value: "/var/run/opencrane/outbound-ca/ca.crt" }], volumeMounts: [{ name: "additional-ca-certificates", mountPath: "/var/run/opencrane/outbound-ca", readOnly: true }] }],
        volumes: [{ name: "additional-ca-certificates", secret: { secretName: "hosted-generated-file-ca", defaultMode: 0o440, items: [{ key: "ca.crt", path: "ca.crt" }] } }],
      },
    } },
  };
}

test("a rendered server must actually consume the selected certificate key", () =>
{
  assert.doesNotThrow(() => assertHostedServerTrust([_configuredServer()]));
  const resource = _configuredServer();
  resource.spec.template.spec.containers[0].env = [];
  assert.throws(() => assertHostedServerTrust([resource]), /blocked/u);
  assert.throws(() => assertHostedServerTrust([]), /blocked/u);
});

test("a trust reference must retain exact key, revision and read-only permissions", () =>
{
  for (const mutate of [
    resource => { resource.spec.template.spec.volumes[0].secret.items.push({ key: "private-key", path: "private-key" }); },
    resource => { resource.spec.template.spec.volumes[0].secret.secretName = "another-secret"; },
    resource => { resource.spec.template.spec.volumes[0].secret.defaultMode = 0o777; },
    resource => { resource.spec.template.spec.containers[0].volumeMounts[0].readOnly = false; },
    resource => { resource.spec.template.metadata.annotations = {}; },
  ])
  {
    const resource = _configuredServer();
    mutate(resource);
    assert.throws(() => assertHostedServerTrust([resource]), /blocked/u);
  }
});
