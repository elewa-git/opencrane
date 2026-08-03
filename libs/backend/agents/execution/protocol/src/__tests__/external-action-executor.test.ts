import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { __FakeObotMcpInvocationAdapter, __UnavailableObotMcpInvocationAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { MemoryQueryCommand, MemoryQueryResult } from "@opencrane/server/_infra/memory-gateway-client";
import { describe, expect, it, vi } from "vitest";

import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId, MemoryScopeUnavailableError, UnsupportedExternalActionError } from "../external-action-executor.js";
import type { IntegrationAssignmentUnavailableReason } from "../external-action-executor.types.js";

/** Build a candidate for the given tool revision prefix. */
function _candidate(toolRevisionId: string): RuntimeExternalActionCandidate
{
	return { protocolVersion: "opencrane.agent-runtime/v1", runtimeInstanceId: "instance-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId, toolInvocationId: "invocation-1", argumentsDigest: "sha256:d", arguments: { query: "a" } };
}

/** Default dependencies; each transport is the fail-closed stub unless a case injects a real one. */
const DEPENDENCIES ={ siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "cognee-personal-1", agentRevisionId: "revision-1", integrations: { resolveAssignment: async function _resolve() { return { outcome: "resolved" as const, assignment: { integrationId: "calendar", obotCatalogEntryId: "calendar", obotCustodyReference: "obot:calendar", allowedTools: ["calendar.read"] } }; } }, obotMcpInvocation: new __UnavailableObotMcpInvocationAdapter(), sandboxExecutor: new __UnavailableSandboxJobExecutor(), memoryGateway: new __UnavailableMemoryGatewayClient() };

/**
 * Memory gateway double that answers recall and stays fail-closed for every other operation.
 *
 * Extending the unavailable client keeps the five unused methods refusing, so a case can only
 * exercise the seam it actually injected.
 */
class _RecordingMemoryGateway extends __UnavailableMemoryGatewayClient
{
	/** Every recall command the executor issued, in order. */
	readonly queries: MemoryQueryCommand[] = [];

	/** Record the command and answer with one gateway-minted fact. */
	override async query(command: MemoryQueryCommand): Promise<MemoryQueryResult>
	{
		this.queries.push(command);
		return { facts: [{ factId: "fact-1", content: "recalled" }] };
	}
}

/** Proves one live-custody refusal remains typed and never reaches the Obot invocation port. */
async function _expectAssignmentUnavailable(reason: IntegrationAssignmentUnavailableReason): Promise<void>
{
	const invokeTool = vi.fn();
	const executor = __CreateExternalActionExecutor(_candidate("integration:calendar:calendar.read"), { ...DEPENDENCIES, integrations: { resolveAssignment: async function _resolve() { return { outcome: "unavailable" as const, reason }; } }, obotMcpInvocation: { invokeTool } });
	await expect(executor.execute()).rejects.toMatchObject({ name: "IntegrationAssignmentUnavailableError", integrationId: "calendar", reason });
	expect(invokeTool).not.toHaveBeenCalled();
}

describe("composition-root external action executor", function _suite()
{
	it("fails closed when the integration invocation transport is unavailable", async function _integrationUnavailable()
	{
		const executor = __CreateExternalActionExecutor(_candidate("integration:calendar:calendar.read"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toThrow(/Obot MCP invocation authority is unavailable/);
	});

	it("resolves a revision integration and invokes only its allowed tool through Obot", async function _integration()
	{
		const executor = __CreateExternalActionExecutor(_candidate("integration:calendar:calendar.read"), { ...DEPENDENCIES, obotMcpInvocation: new __FakeObotMcpInvocationAdapter({ content: { result: "ok" } }) });
		await expect(executor.execute()).resolves.toEqual({ result: "ok" });
	});

	it("preserves a revoked live assignment as a typed refusal without calling Obot", async function _revoked()
	{
		await _expectAssignmentUnavailable("revoked");
	});

	it("preserves an expired live assignment as a typed refusal without calling Obot", async function _expired()
	{
		await _expectAssignmentUnavailable("expired");
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

	it("refuses a memory tool call when the admitted snapshot did not select a personal dataset", async function _deniesMissingMemoryScope()
	{
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, cogneeDatasetId: null });
		await expect(executor.execute()).rejects.toBeInstanceOf(MemoryScopeUnavailableError);
	});

	it("routes an injected memory gateway with the frozen dataset, never a subject-derived one", async function _injectedMemoryGateway()
	{
		const memoryGateway = new _RecordingMemoryGateway();
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, memoryGateway });

		await expect(executor.execute()).resolves.toEqual([{ factId: "fact-1", content: "recalled" }]);
		expect(memoryGateway.queries[0]).toMatchObject({ siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "cognee-personal-1", query: "a" });
	});

	it("selects personal memory only from the frozen user policy", function _selectsFrozenMemory()
	{
		const snapshot = { identitySnapshot: { kind: "user" }, memoryQueryPolicy: { scope: "personal", cogneeDatasetId: "personal-1" } } as unknown as RunInputSnapshot;
		expect(__PersonalMemoryDatasetId(snapshot)).toBe("personal-1");
		expect(__PersonalMemoryDatasetId({ ...snapshot, identitySnapshot: { kind: "service" } } as unknown as RunInputSnapshot)).toBeNull();
		expect(__PersonalMemoryDatasetId({ ...snapshot, memoryQueryPolicy: { scope: "personal" } } as unknown as RunInputSnapshot)).toBeNull();
	});

	it("refuses a tool revision that names no wired transport kind", async function _unsupported()
	{
		const executor = __CreateExternalActionExecutor(_candidate("unknown:thing"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toBeInstanceOf(UnsupportedExternalActionError);
	});

});
