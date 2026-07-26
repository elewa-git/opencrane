import type { RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { __UnavailableObotCustodyAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import { describe, expect, it } from "vitest";

import { __CreateExternalActionExecutor, UnsupportedExternalActionError } from "../external-action-executor.js";

/** Build a candidate for the given tool revision prefix. */
function _candidate(toolRevisionId: string): RuntimeExternalActionCandidate
{
	return { protocolVersion: "opencrane.agent-runtime/v1", runtimeInstanceId: "instance-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId, toolInvocationId: "invocation-1", argumentsDigest: "sha256:d", arguments: { query: "a" } };
}

/** The composition root wires only fail-closed transports until a real one is verified. */
const DEPENDENCIES = { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", obotCustody: new __UnavailableObotCustodyAdapter(), sandboxExecutor: new __UnavailableSandboxJobExecutor(), memoryGateway: new __UnavailableMemoryGatewayClient() };

describe("composition-root external action executor", function _suite()
{
	it("routes an MCP tool call through the fail-closed Obot custody port", async function _mcp()
	{
		const executor = __CreateExternalActionExecutor(_candidate("mcp-server:server-1"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toThrow(/Obot custody authority is unavailable/);
	});

	it("fails closed for a sandbox tool call when no sandbox transport is available", async function _sandbox()
	{
		const executor = __CreateExternalActionExecutor(_candidate("sandbox:image-1"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toThrow(/Sandbox execution authority is unavailable/);
	});

	it("fails closed for a memory tool call when no memory gateway is available", async function _memory()
	{
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toThrow(/Memory gateway is unavailable/);
	});

	it("forwards the immutable organization coordinate to the memory gateway", async function _forwardsOrganization()
	{
		const queries: unknown[] = [];
		const memoryGateway = { query: async function _query(command: unknown) { queries.push(command); return { facts: [] }; } } as never;
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, memoryGateway });
		await expect(executor.execute()).resolves.toEqual([]);
		expect(queries).toEqual([{ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1", query: "a", maxResults: 20 }]);
	});

	it("refuses a tool revision that names no wired transport kind", async function _unsupported()
	{
		const executor = __CreateExternalActionExecutor(_candidate("unknown:thing"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toBeInstanceOf(UnsupportedExternalActionError);
	});

});
