#!/usr/bin/env bash
set -euo pipefail

image="opencrane-mcp-file-generator:smoke"
container=""
runtime_log="$(mktemp)"

_cleanup()
{
	if test -n "$container"; then
		docker logs "$container" >"$runtime_log" 2>&1 || true
		docker rm -f "$container" >/dev/null 2>&1 || true
	fi
	rm -f "$runtime_log"
}
trap _cleanup EXIT

docker build -t "$image" -f apps/mcp-file-generator/deploy/Dockerfile .
container="$(docker run -d --network none "$image")"

for _attempt in $(seq 1 50); do
	if docker exec "$container" node -e 'fetch("http://127.0.0.1:3000/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "ready", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }) }).then(response => { if (!response.ok) process.exit(1); })' >/dev/null 2>&1; then
		break
	fi
	if ! docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -Fxq true; then
		docker logs "$container" >&2
		exit 1
	fi
	sleep 0.1
done

test "$(docker exec "$container" id -u)" = 65532
docker exec -i "$container" node --input-type=module <<'NODE'
import assert from "node:assert/strict";

const endpoint = "http://127.0.0.1:3000/mcp";
const metadata = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientCapabilities": {},
};

async function post(id, method, params = {})
{
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: metadata } }),
	});
	assert.equal(response.status, 200);
	return response.json();
}

const discovery = await post("discovery", "server/discover");
assert.deepEqual(discovery.result.supportedVersions, ["2026-07-28"]);
assert.deepEqual(discovery.result.capabilities, { tools: {} });

const listed = await post("tools", "tools/list");
assert.equal(listed.result.tools.length, 1);
assert.equal(listed.result.tools[0].name, "opencrane_files_create_csv");

const called = await post("invocation-1", "tools/call", {
	name: "opencrane_files_create_csv",
	arguments: { displayName: "customers.csv", headers: ["Name", "Balance"], rows: [["Amina", -12.5]] },
});
assert.deepEqual(called.result, {
	resultType: "complete",
	isError: false,
	content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/csv;charset=utf-8", text: "Name,Balance\r\nAmina,-12.5\r\n" } }],
});
NODE

if docker logs "$container" 2>&1 | grep -Fq "ERR_MODULE_NOT_FOUND"; then
	docker logs "$container" >&2
	exit 1
fi
printf "offline mcp-file-generator image discovery, tool listing and CSV call passed\n"
