import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationGeneratedFileResultStates, type ConversationGeneratedFileResultCommand } from "@opencrane/backend/server/conversations";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { GeneratedFileResultKinds, type GeneratedFileResultMetadata, type McpToolCallResult } from "@opencrane/contracts";

import { PrismaConversationAssetProductAuthorizationRepository } from "../../../conversation-asset-product-authorization";
import { _GeneratedFileCapturedMetadataResult } from "../../persistence/generated-file-capture-result";
import { PrismaConversationGeneratedFileRecordRepository } from "../../persistence/workflow/prisma-conversation-generated-file-record-repository";
import { GeneratedFileWorkflowFailureCodes } from "../../persistence/workflow/generated-file-workflow-persistence.types";
import { GeneratedFileWorkflowStates } from "../../workflow/generated-file-workflow.types";
import { PrismaConversationGeneratedFileResultRepository } from "../prisma-conversation-generated-file-result-repository";

const _NOW = new Date("2026-09-13T12:00:00.000Z");

/** Build the canonical metadata result from the same saved coordinates used by production. */
function _Result(patch: Partial<GeneratedFileResultMetadata> = {}): McpToolCallResult
{
	return _GeneratedFileCapturedMetadataResult({
		kind: GeneratedFileResultKinds.Captured, operationId: "operation-1", assetId: "asset-1",
		artifactId: "artifact-1", artifactRevisionId: "revision-1",
		rawResultDigest: `sha256:${"a".repeat(64)}`, displayName: "counties.csv",
		mediaType: "text/csv;charset=utf-8", byteLength: 24,
		...patch,
	});
}

/** Return the saved invocation already accepted by IAM's result reader. */
function _Invocation(patch: Partial<ToolInvocationRecord> = {}): ToolInvocationRecord
{
	return {
		id: "invocation-row-1", siloId: "silo-1", agentRevisionId: "revision-agent-1", authorizationEvidence: null,
		runId: "run-1", attempt: 2, mcpTaskId: null, requestIdentity: { runtimeInstanceId: "computer-1", commandId: "bootstrap-1", candidateId: "candidate-1" },
		toolInvocationId: "proposal-1", toolRevisionId: "tool-revision-1", arguments: {}, argumentsDigest: `sha256:${"b".repeat(64)}`,
		effectiveArguments: {}, effectiveArgumentsDigest: `sha256:${"b".repeat(64)}`, requestFingerprint: `sha256:${"c".repeat(64)}`,
		approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null, state: ToolInvocationStates.Succeeded,
		preparationAttempt: 1, retryDeadlineAt: new Date("2026-09-13T12:01:00.000Z"), nextPreparationAttemptAt: new Date("2026-09-13T12:00:00.000Z"),
		claimAttempt: 1, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 7,
		claimExpiresAt: null, result: _Result() as never, failureCode: null, revision: 4,
		...patch,
	};
}

/** Complete persisted coordinates selected only through the actual invocation row id. */
function _Operation(patch: Record<string, unknown> = {})
{
	return {
		id: "operation-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2,
		bootstrapId: "bootstrap-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3,
		agentIdentityId: "identity-1", requesterPrincipalId: "principal-1", requesterSubject: "subject-1",
		toolInvocationRowId: "invocation-row-1", toolInvocationId: "proposal-1", toolRevisionId: "tool-revision-1",
		serverRevisionId: "server-revision-1", rawResultDigest: `sha256:${"a".repeat(64)}`, assetId: "asset-1",
		artifactId: "artifact-1", revisionId: "revision-1", uploadLeaseId: "upload-lease-1", displayName: "counties.csv",
		mediaType: "text/csv;charset=utf-8", byteLength: 24n, workflowTaskId: "task-1",
		workflowTaskName: "conversation-generated-file", workflowTaskKey: "conversation-generated-file:operation-1",
		...patch,
	};
}

/** Current turn and admission must independently match every saved operation coordinate. */
function _Command(patch: Partial<ConversationGeneratedFileResultCommand> = {}): ConversationGeneratedFileResultCommand
{
	const invocation = _Invocation();
	return {
		turn: {
			bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1",
			binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 3,
				agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Assistant", agentAvatarArtifactRevisionId: null,
				runId: "run-1", expectedRevision: 2n, maximumEntryBytes: 10_000 },
			lease: { leaseId: "lease-1", leaseGeneration: 3, sandboxClaimId: "claim-1" },
			compile: { runId: "run-1", attempt: 2, promptCompilerVersion: "v1", digest: `sha256:${"d".repeat(64)}` },
			latestPendingEntryId: "entry-1", latestPendingEntryPosition: "1", modelAlias: "model", maximumBudgetUsd: 1,
			credentialLifetimeSeconds: 60, outputSourceCommandId: null, outputReceipt: null, cancellationReceipt: null,
			toolSelection: { proposalId: "proposal-1", requestFingerprint: invocation.requestFingerprint, payloadRef: "payload-1", ciphertextDigest: `sha256:${"e".repeat(64)}` },
			continuationReservation: null, modelReservation: null,
		},
		invocation,
		payload: { toolInvocationId: "proposal-1", outcome: "succeeded", result: _Result() as never },
		admission: {
			conversationId: "conversation-1", requesterSubjectId: "subject-1", notAfterEpochMs: _NOW.getTime() + 60_000,
			identity: { kind: "proxied", id: "identity-1", siloId: "silo-1", principalId: "principal-1", proxiedPrincipalId: "principal-1" } as never,
			subject: { siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1",
				runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-agent-1" },
				computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3 },
				requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", membership: { siloId: "silo-1", principalId: "principal-1" } },
			} as never,
		},
		...patch,
	};
}

/** Supply validated lifecycle records while keeping this suite focused on result projection. */
function _Record(state: GeneratedFileWorkflowStates, failureCode: string | null = null)
{
	return { snapshot: { state, siloId: "silo-1", operationId: "operation-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", uploadLeaseId: "upload-lease-1", contentAddress: `sha256:${"f".repeat(64)}`, byteLength: 24, mediaType: "text/csv;charset=utf-8", notAfterEpochMs: _NOW.getTime() + 60_000 }, failureCode };
}

/** Assemble transaction and existing owner doubles for one projection read. */
function _Harness(operation: ReturnType<typeof _Operation> | null = _Operation())
{
	const transaction = { conversationGeneratedFile: { findUnique: vi.fn().mockResolvedValue(operation) } };
	const loadCurrent = vi.fn().mockResolvedValue({ ..._Record(GeneratedFileWorkflowStates.ScanPending).snapshot });
	const repository = new PrismaConversationGeneratedFileResultRepository(transaction as never, { loadCurrent });
	return { transaction, loadCurrent, repository };
}

	describe("Prisma generated-file result projection", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.restoreAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load").mockResolvedValue(_Record(GeneratedFileWorkflowStates.ScanPending) as never);
		vi.spyOn(PrismaConversationAssetProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(true);
	});
	afterEach(function _RestoreClock() { vi.useRealTimers(); });

	it("leaves an ordinary result ordinary when no operation belongs to the invocation", async function _Ordinary()
	{
		const harness = _Harness(null);
		const command = _Command({ payload: { toolInvocationId: "proposal-1", outcome: "succeeded", result: { value: "ordinary" } } });
		await expect(harness.repository.read(command)).resolves.toEqual({ state: ConversationGeneratedFileResultStates.NotGenerated });
	});

	it("rejects generated metadata that has no operation for the actual invocation row", async function _Forged()
	{
		const harness = _Harness(null);
		await expect(harness.repository.read(_Command())).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Unavailable });
	});

	it("returns the operation event deadline while promotion or scanning remains pending", async function _Pending()
	{
		const harness = _Harness();
		await expect(harness.repository.read(_Command())).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Pending, operationId: "operation-1", notAfterEpochMs: _NOW.getTime() + 60_000 });
		expect(harness.loadCurrent).toHaveBeenCalledExactlyOnceWith({ siloId: "silo-1", operationId: "operation-1" }, { taskId: "task-1", taskName: "conversation-generated-file", idempotencyKey: "conversation-generated-file:operation-1" }, _NOW);
	});

	it("returns one server-built Artifact block only after clean lifecycle and current read access", async function _Ready()
	{
		const harness = _Harness();
		vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load").mockResolvedValue(_Record(GeneratedFileWorkflowStates.Ready) as never);
		harness.loadCurrent.mockResolvedValue(_Record(GeneratedFileWorkflowStates.Ready).snapshot);

		await expect(harness.repository.read(_Command())).resolves.toEqual({
			state: ConversationGeneratedFileResultStates.Ready, operationId: "operation-1",
			artifact: { id: "asset-1", kind: "artifact", artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "counties.csv", mediaType: "text/csv;charset=utf-8" },
		});
		expect(PrismaConversationAssetProductAuthorizationRepository.prototype.canAccess).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1" }, { kind: "artifact", id: "artifact-1" }, "read");
	});

	it("refuses a ready file after the original requester loses Artifact read", async function _ReadDenied()
	{
		const harness = _Harness();
		vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load").mockResolvedValue(_Record(GeneratedFileWorkflowStates.Ready) as never);
		vi.spyOn(PrismaConversationAssetProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(false);
		harness.loadCurrent.mockResolvedValue(_Record(GeneratedFileWorkflowStates.Ready).snapshot);
		await expect(harness.repository.read(_Command())).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Unavailable });
	});

	it("returns a saved failure without Artifact coordinates", async function _Failed()
	{
		const harness = _Harness();
		vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load").mockResolvedValue(_Record(GeneratedFileWorkflowStates.Failed, GeneratedFileWorkflowFailureCodes.AuthorityEnded) as never);
		harness.loadCurrent.mockResolvedValue(_Record(GeneratedFileWorkflowStates.Failed).snapshot);
		await expect(harness.repository.read(_Command())).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Failed, operationId: "operation-1", failureCode: GeneratedFileWorkflowFailureCodes.AuthorityEnded });
		expect(PrismaConversationAssetProductAuthorizationRepository.prototype.canAccess).not.toHaveBeenCalled();
	});

	it("returns the failure written when current workflow authority expires during the read", async function _ExpiredToFailed()
	{
		const harness = _Harness();
		const load = vi.spyOn(PrismaConversationGeneratedFileRecordRepository.prototype, "load");
		load.mockResolvedValueOnce(_Record(GeneratedFileWorkflowStates.ScanPending) as never).mockResolvedValueOnce(_Record(GeneratedFileWorkflowStates.Failed, GeneratedFileWorkflowFailureCodes.AuthorityEnded) as never);
		harness.loadCurrent.mockResolvedValue(null);
		await expect(harness.repository.read(_Command())).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Failed, operationId: "operation-1", failureCode: GeneratedFileWorkflowFailureCodes.AuthorityEnded });
	});

	it.each([
		["changed metadata", _Command({ payload: { toolInvocationId: "proposal-1", outcome: "succeeded", result: _Result({ artifactId: "foreign-artifact" }) as never } })],
		["changed capture summary", _Command({ payload: { toolInvocationId: "proposal-1", outcome: "succeeded", result: { ..._Result(), content: [{ type: "text", text: "File is ready." }] } as never } })],
		["foreign conversation admission", _Command({ admission: { ..._Command().admission, conversationId: "conversation-2" } })],
		["substituted turn lease", _Command({ turn: { ..._Command().turn, lease: { ..._Command().turn.lease, leaseGeneration: 4 } } })],
		["different invocation row", _Command({ invocation: _Invocation({ id: "invocation-row-2" }) })],
	])("refuses %s before lifecycle or Artifact reads", async function _RefusesSubstitution(_scenario, command)
	{
		const harness = _Harness();
		await expect(harness.repository.read(command)).resolves.toEqual({ state: ConversationGeneratedFileResultStates.Unavailable });
		expect(harness.loadCurrent).not.toHaveBeenCalled();
		expect(PrismaConversationAssetProductAuthorizationRepository.prototype.canAccess).not.toHaveBeenCalled();
	});
});
