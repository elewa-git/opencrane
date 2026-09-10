import { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { ConversationComputerTurnCandidate } from "@opencrane/backend/server/conversations";
import { ConversationComputerActivationAuthorityAdapter, ConversationComputerTurnAuthorityService, CONVERSATION_COMPUTER_TURN_TASK, _RegisterConversationComputerTurnWorkflow } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("conversation computer turn integration", function _Suite()
{
	afterEach(function _Restore() { vi.restoreAllMocks(); });

	it("flows from activation claim through the registered workflow to one assistant append", async function _Turn()
	{
		const computer = {
			schemaVersion: 1 as const, id: "computer-one", siloId: "testv5", conversationId: "conversation-one", agentIdentityId: "identity-one", profileRevisionId: `sha256:${"a".repeat(64)}`,
			state: ConversationComputerStates.ClaimPending, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
		};
		const lease = {
			schemaVersion: 1 as const, id: "lease-one", computerId: computer.id, generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: null, serviceFQDN: null,
			state: ComputerLeaseStates.Claimed, claimedAt: "2026-09-05T00:00:00.000Z", expiresAt: "2099-09-05T00:00:00.000Z", releasedAt: null,
		};
		vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 1n, computer, lease });
		vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 2n });
		const activation = new ConversationComputerActivationAuthorityAdapter(
			{ resolve: vi.fn().mockResolvedValue({ agentIdentityId: computer.agentIdentityId, profileRevisionId: computer.profileRevisionId }), publishActiveLease: vi.fn().mockResolvedValue(undefined) },
			{} as never,
			{ claim: vi.fn().mockResolvedValue({ claimId: "computer-one-g1", outcome: "existing", sandboxId: "sandbox-one", serviceFQDN: "sandbox-one.testv5.svc.cluster.local" }) } as never,
			{ profileRevisionId: computer.profileRevisionId, profileName: "developer", warmPoolName: "pool", namespace: "testv5", leaseTtlMilliseconds: 60_000 },
		);
		await expect(activation.activate({ siloId: "testv5", computerId: computer.id, conversationId: computer.conversationId, generation: 1, activationEventId: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", causationId: "entry-one", causationPosition: "1" })).resolves.toBe("activated");

		let frozen: any = null;
		const append = vi.fn().mockResolvedValue({});
		const workload = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-one" };
		const candidate: ConversationComputerTurnCandidate = {
			binding: { siloId: "testv5", conversationId: computer.conversationId, computerId: computer.id, leaseGeneration: 1, agentIdentityId: computer.agentIdentityId, agentServiceId: "service-one", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-one", expectedRevision: 1n, maximumEntryBytes: 65_536 },
			compiledInput: { promptCompilerVersion: "v1", runId: "run-one", attempt: 1, instructions: "help", messages: [{ role: "user", content: "hello" }], tools: [], model: { modelAlias: "model-one", maxOutputTokens: null, generatedOutputCapabilities: [] }, budget: { maxModelTurns: 1, maxCompletionTokens: 100, maxCostUsdMicros: 100_000, maxToolInvocations: 0, wallClockDeadlineEpochMs: null }, digest: `sha256:${"b".repeat(64)}` },
			latestPendingEntryId: "entry-one", latestPendingEntryPosition: "1", modelAlias: "model-one", maximumBudgetUsd: 0.1, credentialLifetimeSeconds: 300, credentialExpiresAt: "2099-01-01T00:00:00.000Z",
			lease: { leaseId: "lease-one", leaseGeneration: 1, sandboxClaimId: "computer-one-g1" },
		};
		const execution = { candidate, workload };
		const authority = new ConversationComputerTurnAuthorityService({
			logger: { warn: vi.fn() }, model: { request: vi.fn().mockResolvedValue({ kind: "text", text: "assistant answer" }) }, toolProposals: { admit: vi.fn() }, siloId: "testv5", runLifecycle: { start: vi.fn(), complete: vi.fn() },
			candidates: { resolve: vi.fn().mockResolvedValue(candidate), resolveForWorkflow: vi.fn().mockResolvedValue(execution), assertCurrentForWorkflow: vi.fn().mockResolvedValue(execution), assertLeaseForWorkflow: vi.fn().mockResolvedValue(workload), assertCurrent: vi.fn().mockResolvedValue(candidate), admit: vi.fn() },
			reviewCredentials: { bearer: vi.fn(), derive: vi.fn().mockReturnValue("keyed-review-secret") }, modelCustody: { loadDeclaration: vi.fn().mockResolvedValue(null), storeDeclaration: vi.fn(), loadContinuation: vi.fn(), storeContinuation: vi.fn() }, toolResults: { read: vi.fn(), consume: vi.fn() },
			credentials: { reuseExact: vi.fn(), issueOnce: vi.fn().mockResolvedValue({ key: "sk-turn", credentialDigest: "sha256:key", expiresAt: "2099-01-01T00:00:00.000Z" }), revoke: vi.fn() }, endpoint: "http://model.stub",
			outputPayloads: { store: vi.fn().mockResolvedValue({ blockId: "block-one", payloadRef: "payload-one", ciphertextDigest: "sha256:cipher" }) },
			store: { reserveModel: vi.fn(async (_id, reservation) => { frozen = { ...frozen, modelReservation: reservation }; return true; }), reserveContinuation: vi.fn(), selectTool: vi.fn(), createOrRead: vi.fn(async turn => (frozen ??= turn)), load: vi.fn(async () => frozen), markOutput: vi.fn(async function _Mark(_turnId, receipt) { frozen = { ...frozen, outputReceipt: receipt, outputSourceCommandId: receipt.event.id }; return { outcome: "accepted" as const, receipt }; }), loadActive: vi.fn().mockResolvedValue(null), settle: vi.fn() },
			writers: { create: vi.fn(turn => ({ confirm: append, prepare: async function _Prepare(command: Parameters<BoundConversationWriter["prepare"]>[0]) { return new BoundConversationWriter({} as never, turn.binding, { now: function _Now() { return new Date(); } }, { assertMayAppend: async function _Rate() {} }, { assertMayUseVisibility: async function _Visibility() {} }, { assertMayAppend: async function _Fence() {} }).prepare(command); } })) },
		});

		let definition!: IWorkflowTaskDefinition<any, unknown>;
		const workflows = { register: vi.fn(value => { definition = value; }) };
		_RegisterConversationComputerTurnWorkflow(workflows as never, { authority, receipts: { bind: vi.fn().mockResolvedValue(true) }, siloId: "testv5" });
		const activationEventId = "41c1f1dc-0010-4f13-9c2f-d3841ffd6651";
		const context = { task: { taskId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: activationEventId }, attempt: 1, checkpoint: vi.fn(), spawnChild: vi.fn(), awaitChild: vi.fn(), sleepUntil: vi.fn(), waitForEvent: vi.fn() } as unknown as IWorkflowTaskContext;
		await expect(definition.run(context, { siloId: "testv5", computerId: "computer-one", leaseId: "lease-one", leaseGeneration: 1, activationEventId, causationId: "entry-one", causationPosition: "1" })).resolves.toMatchObject({ outcome: "completed" });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ data: expect.objectContaining({ entry: expect.objectContaining({ kind: "message", blocks: [expect.objectContaining({ payloadRef: "payload-one" })] }) }) }) }));
		expect(context.checkpoint).not.toHaveBeenCalled();
	});
});
