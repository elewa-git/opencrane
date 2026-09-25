import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationAssetState } from "@prisma/client";

import { ConversationComputerTurnProtocolStates, ConversationGeneratedFileResultStates, PrismaConversationToolDispatchAuthority, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import * as ToolResults from "@opencrane/backend/server/iam/authorization";
import { ConversationModelToolModes, GeneratedFileResultKinds } from "@opencrane/contracts";

import { _GeneratedFileCapturedMetadataResult } from "../../persistence/generated-file-capture-result";
import { PrismaConversationGeneratedFileRecordRepository } from "../../persistence/workflow/prisma-conversation-generated-file-record-repository";
import { GeneratedFileWorkflowStates } from "../../workflow/generated-file-workflow.types";
import { PrismaConversationGeneratedFileOutputLinkUnitOfWork } from "../prisma-conversation-generated-file-output-link-unit-of-work";

const _MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _ARTIFACT = { id: "asset-1", kind: "artifact" as const, artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "counties.csv", mediaType: "text/csv;charset=utf-8" };

/** Return one exact saved Text and Artifact answer. */
function _Turn(): FrozenConversationComputerTurn
{
	const entry = {
		schemaVersion: 1 as const, id: _MESSAGE_ID, conversationId: "conversation-1", position: "3",
		author: { kind: "agent" as const, agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Assistant", avatarArtifactRevisionId: null },
		provenance: "agent-authored" as const, visibility: { audience: "conversation" as const }, runId: "run-1",
		causationId: "entry-1", correlationId: "entry-1", idempotencyKey: _MESSAGE_ID,
		occurredAt: "2026-09-13T12:00:00.000Z", attestation: null, kind: "message" as const, state: "completed" as const,
		blocks: [{ id: "text-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: _DIGEST }, _ARTIFACT],
		replyToEntryId: "entry-1", addressedAgentIdentityId: null, activation: "none" as const,
	};
	return {
		bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1",
		binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 3,
			agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Assistant", agentAvatarArtifactRevisionId: null,
			runId: "run-1", expectedRevision: 2n, maximumEntryBytes: 65_536 },
		lease: { leaseId: "lease-1", leaseGeneration: 3, sandboxClaimId: "claim-1" },
		compile: { runId: "run-1", attempt: 2, promptCompilerVersion: "v1", digest: _DIGEST },
		latestPendingEntryId: "entry-1", latestPendingEntryPosition: "1", modelAlias: "model", maximumBudgetUsd: 1,
		credentialLifetimeSeconds: 60,
		budget: { maxModelTurns: 3, maxCompletionTokens: 300, maxCostUsdMicros: null, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: Date.now() + 60_000 },
		protocol: {
			state: ConversationComputerTurnProtocolStates.OutputRecorded, revision: 5n,
			accounting: { reservedModelCalls: 2, reservedCompletionTokens: 200, reservedToolInvocations: 1, toolResultCyclesFed: 1 },
			output: { sourceCommandId: _MESSAGE_ID, receipt: { streamName: "conversation-conversation-1", expectedRevision: "2", event: { id: _MESSAGE_ID, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: "silo-1" } } } },
			cancellation: null, unavailable: null,
			steps: [{
				state: ConversationComputerTurnProtocolStates.ResultReady,
				reservation: { ordinal: 1, invocationFence: "first-fence", tools: ConversationModelToolModes.Select, compiledInputDigest: _DIGEST, historyDigest: _DIGEST, requestDigest: _DIGEST, maxCompletionTokens: 100, authorityExpiresAtEpochMs: Date.now() + 60_000, dispatchDeadlineEpochMs: Date.now() + 30_000 },
				selection: { ordinal: 1, modelInvocationFence: "first-fence", proposalId: "proposal-1", toolInvocationId: "proposal-1", requestFingerprint: _DIGEST, declaration: { payloadRef: "declaration-1", ciphertextDigest: _DIGEST } },
				result: { ordinal: 1, proposalId: "proposal-1", toolInvocationId: "proposal-1", resultDigest: _DIGEST, authorityExpiresAtEpochMs: Date.now() + 60_000, exchange: { payloadRef: "exchange-1", ciphertextDigest: _DIGEST } },
			}, {
				state: ConversationComputerTurnProtocolStates.ModelReserved, selection: null, result: null,
				reservation: { ordinal: 2, invocationFence: _MESSAGE_ID, tools: ConversationModelToolModes.None, compiledInputDigest: _DIGEST, historyDigest: _DIGEST, requestDigest: _DIGEST, maxCompletionTokens: 100, authorityExpiresAtEpochMs: Date.now() + 60_000, dispatchDeadlineEpochMs: Date.now() + 30_000 },
			}],
		},
	} as FrozenConversationComputerTurn;
}

/** Return the relational operation selected by the Artifact block. */
function _Operation(messageId: string | null = null)
{
	return {
		id: "operation-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2,
		bootstrapId: "bootstrap-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3,
		agentIdentityId: "identity-1", requesterPrincipalId: "principal-1", requesterSubject: "subject-1",
		toolInvocationRowId: "invocation-row-1", toolInvocationId: "proposal-1", toolRevisionId: "tool-revision-1",
		rawResultDigest: _DIGEST, assetId: "asset-1", artifactId: "artifact-1",
		revisionId: "revision-1", displayName: "counties.csv", mediaType: "text/csv;charset=utf-8",
		byteLength: 24n,
		asset: { messageId, state: ConversationAssetState.Ready, artifactId: "artifact-1", revisionId: "revision-1" },
	};
}

/** Build one transaction-backed linker with current-authority doubles. */
function _Harness(messageId: string | null = null)
{
	const operation = _Operation(messageId);
	let winnerMessageId = messageId;
	const findUnique = vi.fn().mockImplementation(async function _Find(input: { readonly select?: { readonly messageId?: boolean } })
	{
		return input.select?.messageId === true ? { messageId: winnerMessageId } : operation;
	});
	const updateMany = vi.fn().mockImplementation(async function _Update()
	{
		operation.asset.messageId = _MESSAGE_ID;
		winnerMessageId = _MESSAGE_ID;
		return { count: 1 };
	});
	const transaction = { conversationGeneratedFile: { findUnique }, conversationAsset: { updateMany, findUnique } };
	const prisma = { $transaction: vi.fn(async function _Transaction(run: (value: typeof transaction) => Promise<unknown>) { return run(transaction); }) };
	const turn = _Turn();
	const load = vi.fn().mockResolvedValue(turn);
	const read = vi.fn().mockResolvedValue({ state: ConversationGeneratedFileResultStates.Ready, operationId: "operation-1", artifact: _ARTIFACT });
	const generatedResults = vi.fn().mockReturnValue({ read });
	const linker = new PrismaConversationGeneratedFileOutputLinkUnitOfWork(prisma as never, { load }, generatedResults, {} as never);
	return { findUnique, generatedResults, linker, load, operation, read, transaction, turn, updateMany, setWinner(message: string) { winnerMessageId = message; } };
}

describe("Prisma generated-file output linker", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.restoreAllMocks();
		const result = _GeneratedFileCapturedMetadataResult({ kind: GeneratedFileResultKinds.Captured, operationId: "operation-1", assetId: "asset-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", rawResultDigest: _DIGEST, displayName: "counties.csv", mediaType: "text/csv;charset=utf-8", byteLength: 24 });
		const invocation = { id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationId: "proposal-1", toolRevisionId: "tool-revision-1", requestIdentity: { runtimeInstanceId: "computer-1", commandId: "bootstrap-1", candidateId: "candidate-1" }, state: ToolResults.ToolInvocationStates.Succeeded, result };
		vi.spyOn(ToolResults, "__FindToolInvocationInTransaction").mockResolvedValue(invocation as never);
		vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load").mockResolvedValue({ snapshot: { state: GeneratedFileWorkflowStates.Ready } } as never);
		vi.spyOn(ToolResults, "__ReadRunToolResultInTransaction").mockResolvedValue({ outcome: ToolResults.RunToolResultReadOutcomes.Available, invocation: invocation as never, payload: { toolInvocationId: "proposal-1", outcome: "succeeded", result: result as never }, payloadDigest: _DIGEST, occurredAt: "2026-09-13T12:00:00.000Z", consumed: true });
		vi.spyOn(PrismaConversationToolDispatchAuthority.prototype, "admitSystem").mockResolvedValue({ notAfterEpochMs: Date.now() + 60_000 } as never);
	});

	it("links one current Ready result to the exact saved output message", async function _Links()
	{
		const harness = _Harness();
		await harness.linker.link(harness.turn);

		expect(ToolResults.__ReadRunToolResultInTransaction).toHaveBeenCalledWith(harness.transaction, expect.objectContaining({ toolInvocationId: "proposal-1", commandId: "bootstrap-1" }));
		expect(PrismaConversationToolDispatchAuthority.prototype.admitSystem).toHaveBeenCalledWith(expect.objectContaining({ id: "invocation-row-1" }), expect.any(Date), "opencrane-server/conversation-generated-file-v1");
		expect(harness.read).toHaveBeenCalledWith(expect.objectContaining({ turn: harness.turn, payload: expect.objectContaining({ toolInvocationId: "proposal-1" }) }));
		expect(harness.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "asset-1", messageId: null, state: ConversationAssetState.Ready }), data: { messageId: _MESSAGE_ID } }));
	});

	it("links the exact last result after an earlier tool cycle", async function _LinksLaterStep()
	{
		const harness = _Harness();
		const resultStep = harness.turn.protocol.steps[0]!;
		const finalStep = harness.turn.protocol.steps[1]!;
		if (resultStep.result === null || resultStep.selection === null)
			throw new Error("Fixture requires a saved tool result");
		const earlier = { ...resultStep,
			reservation: { ...resultStep.reservation, invocationFence: "earlier-fence" },
			selection: { ...resultStep.selection, modelInvocationFence: "earlier-fence", proposalId: "earlier-proposal", toolInvocationId: "earlier-proposal", declaration: { ...resultStep.selection.declaration, payloadRef: "earlier-declaration" } },
			result: { ...resultStep.result, proposalId: "earlier-proposal", toolInvocationId: "earlier-proposal", exchange: { ...resultStep.result.exchange, payloadRef: "earlier-exchange" } },
		};
		const turn = { ...harness.turn, protocol: { ...harness.turn.protocol, revision: 8n,
			accounting: { reservedModelCalls: 3, reservedCompletionTokens: 300, reservedToolInvocations: 2, toolResultCyclesFed: 2 },
			steps: [earlier,
				{ ...resultStep, reservation: { ...resultStep.reservation, ordinal: 2 }, selection: { ...resultStep.selection, ordinal: 2 }, result: { ...resultStep.result, ordinal: 2 } },
				{ ...finalStep, reservation: { ...finalStep.reservation, ordinal: 3 } },
			],
		} };
		harness.load.mockResolvedValue(turn);

		await expect(harness.linker.link(turn)).resolves.toBeUndefined();
		expect(ToolResults.__ReadRunToolResultInTransaction).toHaveBeenCalledWith(harness.transaction,
			expect.objectContaining({ toolInvocationId: "proposal-1" }));
		expect(harness.updateMany).toHaveBeenCalledTimes(1);
	});

	it("rejects a file whose saved result digest differs from the result feeding the answer", async function _RejectsDifferentResult()
	{
		const harness = _Harness();
		const turn = { ...harness.turn, protocol: { ...harness.turn.protocol,
			steps: harness.turn.protocol.steps.map(step => step.result === null ? step : { ...step, result: { ...step.result, resultDigest: `sha256:${"b".repeat(64)}` } }),
		} };
		harness.load.mockResolvedValue(turn);

		await expect(harness.linker.link(turn)).rejects.toThrow("result is no longer available");
		expect(harness.updateMany).not.toHaveBeenCalled();
	});

	it("recognizes the exact link after run authority ends without another result read", async function _RecoversLinked()
	{
		const harness = _Harness(_MESSAGE_ID);
		await harness.linker.link(harness.turn);

		expect(ToolResults.__ReadRunToolResultInTransaction).not.toHaveBeenCalled();
		expect(PrismaConversationToolDispatchAuthority.prototype.admitSystem).not.toHaveBeenCalled();
		expect(harness.read).not.toHaveBeenCalled();
		expect(harness.updateMany).not.toHaveBeenCalled();
	});

	it("rejects changed historical result evidence even for an already linked asset", async function _ChangedSavedResult()
	{
		const harness = _Harness(_MESSAGE_ID);
		vi.mocked(ToolResults.__FindToolInvocationInTransaction).mockResolvedValue({ id: "invocation-row-1", result: { changed: true } } as never);

		await expect(harness.linker.link(harness.turn)).rejects.toThrow("saved invocation");
		expect(ToolResults.__ReadRunToolResultInTransaction).not.toHaveBeenCalled();
	});

	it("refuses a fresh link when current dispatch authority ended", async function _Ended()
	{
		const harness = _Harness();
		vi.spyOn(PrismaConversationToolDispatchAuthority.prototype, "admitSystem").mockResolvedValue(null);

		await expect(harness.linker.link(harness.turn)).rejects.toThrow("authority ended");
		expect(harness.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		["unconsumed", { consumed: false }],
		["different continuation digest", { payloadDigest: `sha256:${"b".repeat(64)}` }],
	])("refuses %s result evidence before a fresh link", async function _ResultEvidence(_label, patch)
	{
		const harness = _Harness();
		const current = await ToolResults.__ReadRunToolResultInTransaction({} as never, {} as never);
		vi.mocked(ToolResults.__ReadRunToolResultInTransaction).mockResolvedValue({ ...current, ...patch } as never);

		await expect(harness.linker.link(harness.turn)).rejects.toThrow("no longer available");
		expect(harness.updateMany).not.toHaveBeenCalled();
	});

	it("refuses a substituted operation behind the saved Artifact block", async function _Substituted()
	{
		const harness = _Harness();
		harness.operation.runId = "other-run";

		await expect(harness.linker.link(harness.turn)).rejects.toThrow("captured operation");
		expect(ToolResults.__ReadRunToolResultInTransaction).not.toHaveBeenCalled();
	});

	it("accepts only the exact concurrent CAS winner", async function _ConcurrentWinner()
	{
		const harness = _Harness();
		harness.updateMany.mockResolvedValue({ count: 0 });
		harness.setWinner(_MESSAGE_ID);

		await expect(harness.linker.link(harness.turn)).resolves.toBeUndefined();
		const loser = _Harness();
		loser.updateMany.mockResolvedValue({ count: 0 });
		loser.setWinner("22222222-2222-4222-8222-222222222222");
		await expect(loser.linker.link(loser.turn)).rejects.toThrow("changed before commit");
	});

	it("rolls back when original authority expires during the link CAS", async function _ExpiresDuringCas()
	{
		const harness = _Harness();
		const now = Date.now();
		const expiring = { ...harness.turn, protocol: { ...harness.turn.protocol, steps: harness.turn.protocol.steps.map(step => step.result === null ? step : { ...step, result: { ...step.result, authorityExpiresAtEpochMs: now + 100 } }) } };
		harness.load.mockResolvedValue(expiring);
		vi.spyOn(PrismaConversationToolDispatchAuthority.prototype, "admitSystem").mockResolvedValue({ notAfterEpochMs: now + 100 } as never);
		vi.spyOn(Date, "now").mockReturnValueOnce(now).mockReturnValueOnce(now + 101);

		await expect(harness.linker.link(expiring)).rejects.toThrow("expired while linking");
		expect(harness.updateMany).toHaveBeenCalledOnce();
	});
});
