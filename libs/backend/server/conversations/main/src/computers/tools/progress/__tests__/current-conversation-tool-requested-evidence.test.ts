import { describe, expect, it, vi } from "vitest";

import type { FrozenConversationComputerTurn } from "../../../turns/conversation-computer-turn.types";
import type { ConversationToolRequestedNotificationCommand } from "../../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";
import { CurrentConversationToolRequestedNotificationEvidenceReader } from "../current-conversation-tool-requested-evidence";

const _COMMAND: ConversationToolRequestedNotificationCommand = { bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: "invoke-1" };

/** Build one selected turn, current compiled input and committed proposal row. */
function _Fixture()
{
	const tool = { name: "records.read", modelName: "records_read", toolRevisionId: "tool-revision-1", description: "Read one record", requiresApproval: false, parametersSchema: { type: "object" }, parametersSchemaDigest: `sha256:${"b".repeat(64)}` };
	const compiledInput = { promptCompilerVersion: "compiler-v1", runId: "run-1", attempt: 1, instructions: "help", messages: [], tools: [tool], model: { modelAlias: "model-1", maxOutputTokens: 100, generatedOutputCapabilities: [] }, budget: { maxModelTurns: 2, maxCompletionTokens: 200, maxCostUsdMicros: 10, maxToolInvocations: 1, wallClockDeadlineEpochMs: Date.parse("2099-09-12T00:00:00.000Z") }, digest: `sha256:${"a".repeat(64)}` };
	const turn = { bootstrapId: "turn-1", siloId: "silo-1", computerId: "computer-1", binding: { siloId: "silo-1", conversationId: "conversation-1", runId: "run-1" }, compile: { runId: compiledInput.runId, attempt: compiledInput.attempt, promptCompilerVersion: compiledInput.promptCompilerVersion, digest: compiledInput.digest }, toolSelection: { proposalId: "invoke-1", requestFingerprint: "sha256:fingerprint" }, continuationReservation: null, outputReceipt: null, cancellationReceipt: null } as FrozenConversationComputerTurn;
	const invocation = { siloId: "silo-1", runId: "run-1", attempt: 1, mcpTaskId: null, runtimeInstanceId: "computer-1", commandId: "turn-1", candidateId: "invoke-1", toolRevisionId: "tool-revision-1", toolInvocationId: "invoke-1", requestFingerprint: "sha256:fingerprint", createdAt: new Date("2026-09-11T10:00:00.000Z") };
	const load = vi.fn().mockResolvedValue(turn);
	const assertCurrentForWorkflow = vi.fn().mockResolvedValue({ candidate: { ...turn, compiledInput }, workload: {} });
	const findUnique = vi.fn().mockResolvedValue(invocation);
	const transaction = { toolInvocation: { findUnique } };
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => Promise<unknown>) { return work(transaction); }) };
	const reader = new CurrentConversationToolRequestedNotificationEvidenceReader(prisma as never, { load }, { assertCurrentForWorkflow });
	return { reader, turn, invocation, findUnique, assertCurrentForWorkflow };
}

describe("current conversation tool requested evidence", function _Suite()
{
	it("projects the frozen name and durable proposal creation time after current turn checks", async function _Current()
	{
		const fixture = _Fixture();
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toEqual({ ..._COMMAND, toolName: "records.read", toolKind: "mcp", occurredAt: "2026-09-11T10:00:00.000Z" });
		expect(fixture.assertCurrentForWorkflow).toHaveBeenCalledWith(fixture.turn);
		expect(fixture.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { runId_attempt_toolInvocationId: { runId: "run-1", attempt: 1, toolInvocationId: "invoke-1" } } }));
	});

	it.each([
		["task-owned invocation", { mcpTaskId: "task-1" }],
		["different saved turn", { commandId: "turn-2" }],
		["different admitted fingerprint", { requestFingerprint: "sha256:other" }],
		["different frozen tool", { toolRevisionId: "tool-revision-2" }],
	] as const)("suppresses a %s", async function _Mismatch(_name, override)
	{
		const fixture = _Fixture();
		fixture.findUnique.mockResolvedValue({ ...fixture.invocation, ...override });
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
	});

	it("does not query proposal persistence after the turn becomes terminal", async function _Terminal()
	{
		const fixture = _Fixture();
		const terminal = { ...fixture.turn, outputReceipt: {} };
		const transaction = { toolInvocation: { findUnique: fixture.findUnique } };
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => Promise<unknown>) { return work(transaction); }) };
		const reader = new CurrentConversationToolRequestedNotificationEvidenceReader(prisma as never, { load: vi.fn().mockResolvedValue(terminal) }, { assertCurrentForWorkflow: fixture.assertCurrentForWorkflow });
		await expect(reader.readCurrent(_COMMAND)).resolves.toBeNull();
		expect(fixture.findUnique).not.toHaveBeenCalled();
	});
});
