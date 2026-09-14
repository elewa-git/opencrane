import { describe, expect, it, vi } from "vitest";

import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes } from "../../../turns/conversation-computer-continuation.types";
import type { FrozenConversationComputerTurn } from "../../../turns/conversation-computer-turn.types";
import { ConversationComputerTurnProtocolStates } from "../../../turns/conversation-computer-turn-protocol.types";
import type { ConversationToolResultNotificationCommand } from "../../../turns/tool-result-notifications/conversation-tool-result-notification.types";
import { CurrentConversationToolResultNotificationEvidenceReader } from "../current-conversation-tool-result-notification-evidence";

const _PAYLOAD = { toolInvocationId: "invoke-1", outcome: "succeeded" as const, result: { private: "content" } };
const _RESULT_DIGEST = ___DigestCanonicalJson(_PAYLOAD);
const _COMMAND: ConversationToolResultNotificationCommand = { bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: "invoke-1", expectedResultDigest: _RESULT_DIGEST };
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", namespace: "computers", serviceAccountName: "computer", podUid: "pod-1" };

/** Build one selected turn and its matching current compiled candidate. */
function _Fixture()
{
	const tool = { name: "records.read", modelName: "records_read", toolRevisionId: "tool-revision-1", description: "Read one record", requiresApproval: false, parametersSchema: { type: "object" }, parametersSchemaDigest: `sha256:${"b".repeat(64)}` };
	const compiledInput = { promptCompilerVersion: "compiler-v1", runId: "run-1", attempt: 1, instructions: "help", messages: [], tools: [tool], model: { modelAlias: "model-1", maxOutputTokens: 100, generatedOutputCapabilities: [] }, budget: { maxModelTurns: 2, maxCompletionTokens: 200, maxCostUsdMicros: 10, maxToolInvocations: 1, maxLoopIterations: 1, wallClockDeadlineEpochMs: Date.parse("2026-09-12T00:00:00.000Z") }, digest: `sha256:${"a".repeat(64)}` };
	const reservation = { ordinal: 1, invocationFence: "model-1", tools: "select", compiledInputDigest: compiledInput.digest, historyDigest: `sha256:${"c".repeat(64)}`, requestDigest: `sha256:${"d".repeat(64)}`, maxCompletionTokens: 100, authorityExpiresAtEpochMs: compiledInput.budget.wallClockDeadlineEpochMs, dispatchDeadlineEpochMs: compiledInput.budget.wallClockDeadlineEpochMs };
	const selection = { ordinal: 1, modelInvocationFence: reservation.invocationFence, declaration: { payloadRef: "payload", ciphertextDigest: `sha256:${"e".repeat(64)}` }, proposalId: "invoke-1", toolInvocationId: "invoke-1", requestFingerprint: `sha256:${"f".repeat(64)}` };
	const protocol = { state: ConversationComputerTurnProtocolStates.ToolPending, revision: 2n, steps: [{ state: ConversationComputerTurnProtocolStates.ToolPending, reservation, selection, result: null }], accounting: { reservedModelCalls: 1, reservedCompletionTokens: 100, reservedToolInvocations: 1, toolResultCyclesFed: 0 }, output: null, unavailable: null, cancellation: null };
	const turn = { bootstrapId: "turn-1", siloId: "silo-1", computerId: "computer-1", binding: { siloId: "silo-1", conversationId: "conversation-1", runId: "run-1" }, compile: { runId: compiledInput.runId, attempt: compiledInput.attempt, promptCompilerVersion: compiledInput.promptCompilerVersion, digest: compiledInput.digest }, budget: compiledInput.budget, protocol } as unknown as FrozenConversationComputerTurn;
	const load = vi.fn().mockResolvedValue(turn);
	const assertCurrentForWorkflow = vi.fn().mockResolvedValue({ candidate: { ...turn, compiledInput }, workload: _WORKLOAD });
	const read = vi.fn().mockResolvedValue({ outcome: ConversationComputerToolResultOutcomes.Available, payload: _PAYLOAD, payloadDigest: _RESULT_DIGEST, toolRevisionId: tool.toolRevisionId, occurredAt: "2026-09-11T10:00:00.000Z", notAfterEpochMs: Date.parse("2026-09-11T10:01:00.000Z") });
	return { reader: new CurrentConversationToolResultNotificationEvidenceReader({ load }, { assertCurrentForWorkflow }, { read }), load, assertCurrentForWorkflow, read, turn, compiledInput };
}

describe("Current conversation tool-result notification evidence", function _Suite()
{
	it("projects only the frozen name and exact terminal evidence after current checks", async function _Current()
	{
		const fixture = _Fixture();
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toEqual({ toolName: "records.read", toolKind: "mcp", outcome: "succeeded", resultDigest: _RESULT_DIGEST, occurredAt: "2026-09-11T10:00:00.000Z" });
		expect(fixture.assertCurrentForWorkflow).toHaveBeenCalledWith(fixture.turn);
		expect(fixture.read).toHaveBeenCalledWith(fixture.turn, _WORKLOAD);
	});

	it.each([
		["changed digest", { result: { payloadDigest: `sha256:${"c".repeat(64)}` } }],
		["changed invocation", { result: { payload: { ..._PAYLOAD, toolInvocationId: "other" } } }],
		["changed compiler", { candidate: { compiledInput: { promptCompilerVersion: "compiler-v2" } } }],
		["unknown tool revision", { result: { toolRevisionId: "other" } }],
		["invalid timestamp", { result: { occurredAt: "yesterday" } }],
	] as const)("suppresses %s", async function _Rejects(_name, change)
	{
		const fixture = _Fixture();
		if ("result" in change && change.result !== undefined)
			fixture.read.mockResolvedValue({ ...(await fixture.read()), ...change.result });
		if ("candidate" in change && change.candidate !== undefined)
			fixture.assertCurrentForWorkflow.mockResolvedValue({ candidate: { ...fixture.turn, compiledInput: { ...fixture.compiledInput, ...change.candidate.compiledInput } }, workload: _WORKLOAD });
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
	});

	it("rejects a stale selection whose model fence no longer matches the current reservation", async function _StaleSelection()
	{
		const fixture = _Fixture();
		const step = fixture.turn.protocol.steps[0]!;
		fixture.load.mockResolvedValue({ ...fixture.turn, protocol: { ...fixture.turn.protocol, steps: [{ ...step, selection: { ...step.selection!, modelInvocationFence: "model-2" } }] } } as FrozenConversationComputerTurn);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
		expect(fixture.assertCurrentForWorkflow).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it("rejects a foreign current step before consulting SQL result evidence", async function _ForeignStep()
	{
		const fixture = _Fixture();
		const step = fixture.turn.protocol.steps[0]!;
		fixture.load.mockResolvedValue({ ...fixture.turn, protocol: { ...fixture.turn.protocol, steps: [{ ...step, selection: { ...step.selection!, proposalId: "invoke-foreign", toolInvocationId: "invoke-foreign" } }] } } as FrozenConversationComputerTurn);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
		expect(fixture.assertCurrentForWorkflow).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it("rejects malformed command coordinates before reading state", async function _Malformed()
	{
		const fixture = _Fixture();
		await expect(fixture.reader.readCurrent({ ..._COMMAND, runId: " " })).rejects.toThrow("immutable workflow coordinates");
		expect(fixture.load).not.toHaveBeenCalled();
	});
});
