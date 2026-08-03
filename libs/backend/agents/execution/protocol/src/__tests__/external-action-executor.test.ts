import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { __FakeObotMcpInvocationAdapter, __UnavailableObotMcpInvocationAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { MemoryQueryCommand, MemoryQueryResult, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "@opencrane/server/_infra/memory-gateway-client";
import { describe, expect, it, vi } from "vitest";

import { __CreateExternalActionExecutor, __FrozenMemoryScope, MemoryScopeUnavailableError, UnsupportedExternalActionError } from "../external-action-executor.js";
import { FrozenMemoryScopeKinds } from "../external-action-executor.types.js";
import type { IntegrationAssignmentUnavailableReason } from "../external-action-executor.types.js";

/** Build a candidate for the given tool revision prefix. */
function _candidate(toolRevisionId: string): RuntimeExternalActionCandidate
{
	return { protocolVersion: "opencrane.agent-runtime/v1", runtimeInstanceId: "instance-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: "external_action", toolRevisionId, toolInvocationId: "invocation-1", argumentsDigest: "sha256:d", arguments: { query: "a" } };
}

/** Default dependencies; each transport is the fail-closed stub unless a case injects a real one. */
const DEPENDENCIES ={ siloId: "silo-1", subjectId: "user-1", frozenMemoryScope: { kind: FrozenMemoryScopeKinds.Personal, cogneeDatasetIds: ["cognee-personal-1"] }, agentRevisionId: "revision-1", integrations: { resolveAssignment: async function _resolve() { return { outcome: "resolved" as const, assignment: { integrationId: "calendar", obotCatalogEntryId: "calendar", obotCustodyReference: "obot:calendar", allowedTools: ["calendar.read"] } }; } }, obotMcpInvocation: new __UnavailableObotMcpInvocationAdapter(), sandboxExecutor: new __UnavailableSandboxJobExecutor(), memoryGateway: new __UnavailableMemoryGatewayClient() };

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
	/** Every provenance-validated shared recall command the executor issued, in order. */
	readonly scopedRecalls: ScopedMemoryRecallCommand[] = [];

	/** Record the command and answer with one gateway-minted fact. */
	override async query(command: MemoryQueryCommand): Promise<MemoryQueryResult>
	{
		this.queries.push(command);
		return { facts: [{ factId: "fact-1", content: "recalled" }] };
	}

	/** Record a shared recall and answer with a gateway-validated provenance envelope. */
	override async recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
	{
		this.scopedRecalls.push(command);
		return { facts: [{ factId: "shared-1", content: "shared recalled", provenance: { centralAgentId: "service-1", agentRevisionId: "revision-1", runId: "run-1", recordedAt: "2026-08-03T00:00:00.000Z", sourceRef: "source-1" } }] };
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

	it("refuses a memory tool call when the admitted snapshot did not select a dataset set", async function _deniesMissingMemoryScope()
	{
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, frozenMemoryScope: null });
		await expect(executor.execute()).rejects.toBeInstanceOf(MemoryScopeUnavailableError);
	});

	it("routes an injected memory gateway with the frozen dataset set, never a subject-derived one", async function _injectedMemoryGateway()
	{
		const memoryGateway = new _RecordingMemoryGateway();
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, memoryGateway });

		await expect(executor.execute()).resolves.toEqual([{ factId: "fact-1", content: "recalled" }]);
		expect(memoryGateway.queries[0]).toMatchObject({ siloId: "silo-1", subjectId: "user-1", cogneeDatasetId: "cognee-personal-1", query: "a" });
	});

	it("uses one provenance-validated recall for every frozen shared scope", async function _recallsAttachedScopes()
	{
		const memoryGateway = new _RecordingMemoryGateway();
		const executor = __CreateExternalActionExecutor(_candidate("memory:recall"), { ...DEPENDENCIES, memoryGateway, frozenMemoryScope: { kind: FrozenMemoryScopeKinds.Attached, cogneeDatasetIds: ["project-1", "team-1"] } });

		await expect(executor.execute()).resolves.toEqual([{ factId: "shared-1", content: "shared recalled" }]);
		expect(memoryGateway.scopedRecalls).toEqual([expect.objectContaining({ cogneeDatasetIds: ["project-1", "team-1"], query: "a" })]);
	});

	it("selects multiple memory scopes only from the frozen run policy", function _selectsFrozenMemory()
	{
		const snapshot = { memoryQueryPolicy: { scope: "attached", datasets: [{ datasetId: "catalog-project-1", cogneeDatasetId: "project-1", scope: "project", subjectType: "group", subjectId: "project-1" }, { datasetId: "catalog-team-1", cogneeDatasetId: "team-1", scope: "team", subjectType: "group", subjectId: "team-1" }] } } as unknown as RunInputSnapshot;
		expect(__FrozenMemoryScope(snapshot)).toEqual({ kind: FrozenMemoryScopeKinds.Attached, cogneeDatasetIds: ["project-1", "team-1"] });
		expect(__FrozenMemoryScope({ ...snapshot, memoryQueryPolicy: { scope: "attached", datasets: [{ datasetId: "catalog-project-1", cogneeDatasetId: "project-1", scope: "project", subjectType: "group", subjectId: "project-1" }, { datasetId: "catalog-project-2", cogneeDatasetId: "project-1", scope: "project", subjectType: "group", subjectId: "project-2" }] } } as unknown as RunInputSnapshot)).toBeNull();
		expect(__FrozenMemoryScope({ ...snapshot, memoryQueryPolicy: { scope: "attached", datasets: [{ datasetId: "catalog-1", cogneeDatasetId: "project-1", scope: "project", subjectType: "group", subjectId: "project-1" }, { datasetId: "catalog-1", cogneeDatasetId: "team-1", scope: "team", subjectType: "group", subjectId: "team-1" }] } } as unknown as RunInputSnapshot)).toBeNull();
		expect(__FrozenMemoryScope({ ...snapshot, memoryQueryPolicy: { scope: "attached" } } as unknown as RunInputSnapshot)).toBeNull();
		expect(__FrozenMemoryScope({ ...snapshot, memoryQueryPolicy: { scope: "personal", datasets: [{ cogneeDatasetId: "personal-1" }, { cogneeDatasetId: "personal-2" }] } } as unknown as RunInputSnapshot)).toBeNull();
	});

	it("refuses a tool revision that names no wired transport kind", async function _unsupported()
	{
		const executor = __CreateExternalActionExecutor(_candidate("unknown:thing"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toBeInstanceOf(UnsupportedExternalActionError);
	});

});
