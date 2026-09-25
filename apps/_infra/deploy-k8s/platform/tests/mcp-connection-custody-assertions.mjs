import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

/** Check the complete rendered authority boundary, including each release's derived namespace. */
function _AssertCustody(file)
{
	const documents = parseAllDocuments(readFileSync(file, "utf8")).map(document => document.toJSON()).filter(Boolean);
	const server = documents.find(document => document.kind === "Deployment" && document.metadata.labels?.["app.kubernetes.io/component"] === "opencrane-server");
	assert.ok(server);
	const pod = server.spec.template.spec;
	const container = pod.containers[0];
	const environment = new Map(container.env.map(entry => [entry.name, entry]));
	const namespace = environment.get("MCP_CONNECTION_CREDENTIAL_NAMESPACE").value;
	assert.match(namespace, /^[a-z0-9][-a-z0-9]{0,61}[a-z0-9]$/u);
	const namespaceObject = documents.find(document => document.kind === "Namespace" && document.metadata.name === namespace);
	assert.ok(namespaceObject);
	const scoped = documents.filter(document => document.metadata?.namespace === namespace);
	assert.deepEqual(scoped.map(document => document.kind).sort(), ["ResourceQuota", "Role", "RoleBinding"]);
	assert.equal(scoped.find(document => document.kind === "ResourceQuota").spec.hard["count/pods"], "0");
	const role = scoped.find(document => document.kind === "Role");
	assert.deepEqual(role.rules, [{ apiGroups: [""], resources: ["secrets"], verbs: ["create", "get", "delete"] }]);
	const binding = scoped.find(document => document.kind === "RoleBinding");
	assert.deepEqual(binding.roleRef, { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: role.metadata.name });
	assert.equal(binding.subjects.length, 1);
	assert.deepEqual(binding.subjects[0], { kind: "ServiceAccount", name: pod.serviceAccountName, namespace: file.includes("other-namespace") ? "server-b" : "server-a" });
	assert.notEqual(namespace, binding.subjects[0].namespace);
	assert.equal(environment.get("MCP_SERVER_SERVICE_ACCOUNT_NAME").value, pod.serviceAccountName);
	assert.equal(environment.get("POD_UID").valueFrom.fieldRef.fieldPath, "metadata.uid");
	const token = pod.volumes.find(volume => volume.name === "mcp-server-token");
	assert.deepEqual(token.projected.sources, [{ serviceAccountToken: { audience: "opencrane-server-mcp", expirationSeconds: 600, path: "token" } }]);
	assert.equal(pod.volumes.find(volume => volume.name === "mcp-connection-material-keyring").secret.secretName, "opencrane-mcp-connection-material");
	assert.equal(container.volumeMounts.find(mount => mount.name === "mcp-connection-material-keyring").readOnly, true);
	assert.equal(container.volumeMounts.find(mount => mount.name === "mcp-server-token").readOnly, true);
	return namespace;
}

const directory = process.argv[2];
const namespaces = ["first.yaml", "second.yaml", "other-namespace.yaml"].map(file => _AssertCustody(join(directory, file)));
assert.equal(new Set(namespaces).size, 3);
