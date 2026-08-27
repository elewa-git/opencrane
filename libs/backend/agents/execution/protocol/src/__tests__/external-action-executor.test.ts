import { RuntimeCandidateKinds, type RunInputSnapshot, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { __UnavailableSandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import { describe, expect, it } from "vitest";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";

import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId, UnsupportedExternalActionError } from "../external-action-executor";

/** Build a candidate for the given tool revision prefix. */
function _candidate(toolRevisionId: string): RuntimeExternalActionCandidate
{
	return { protocolVersion: "opencrane.agent-runtime/v1", runtimeInstanceId: "instance-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId, toolInvocationId: "invocation-1", argumentsDigest: "sha256:d", arguments: { query: "a" } };
}

/** The composition root wires only fail-closed transports until a real one is verified. */
const DEPENDENCIES = { siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", sandboxExecutor: new __UnavailableSandboxJobExecutor() };

describe("composition-root external action executor", function _suite()
{
	it("refuses a retired integration revision before selecting a generic transport", async function _retiredIntegration()
	{
		const executor = __CreateExternalActionExecutor(_candidate("integration:calendar:calendar.read"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toBeInstanceOf(UnsupportedExternalActionError);
	});

	it("fails closed for a sandbox tool call when no sandbox transport is available", async function _sandbox()
	{
		const executor = __CreateExternalActionExecutor(_candidate("sandbox:image-1"), DEPENDENCIES);
		await expect(executor.execute()).rejects.toThrow(/Sandbox execution authority is unavailable/);
	});

	it("never sends a generic memory tool call to Cognee or returns fact content", async function _memory()
	{
		const executor = __CreateExternalActionExecutor(_candidate(PERSONAL_MEMORY_RECALL_TOOL_REVISION), DEPENDENCIES);
		await expect(executor.execute()).rejects.toMatchObject({ name: "PersonalMemorySafeDeliveryRequiredError" });
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
