import { ConversationAssetState, type Prisma } from "@prisma/client";

import { ConversationGeneratedFileResultStates, __ReadConversationGeneratedFileOutput, type ConversationGeneratedFileResultRepository, type ConversationToolSystemExecutionAdmissionAuthority, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { RunToolResultReadOutcomes, ToolInvocationStates, __FindToolInvocationInTransaction, __ReadRunToolResultInTransaction } from "@opencrane/backend/server/iam/authorization";
import { GeneratedFileResultKinds } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _GeneratedFileCapturedMetadataResult } from "../persistence/generated-file-capture-result";
import { PrismaConversationGeneratedFileRecordRepository } from "../persistence/workflow/prisma-conversation-generated-file-record-repository";
import { CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR } from "../persistence/workflow/generated-file-workflow-persistence.types";
import { GeneratedFileWorkflowStates } from "../workflow/generated-file-workflow.types";
import type { GeneratedFileOutputLinkRepository } from "./generated-file-output-link.types";

const _OPERATION_SELECT = {
	id: true, siloId: true, conversationId: true, runId: true, attempt: true, bootstrapId: true,
	computerId: true, leaseId: true, leaseGeneration: true, agentIdentityId: true,
	requesterPrincipalId: true, requesterSubject: true, toolInvocationRowId: true, toolInvocationId: true,
	toolRevisionId: true, rawResultDigest: true, assetId: true, artifactId: true, revisionId: true,
	displayName: true, mediaType: true, byteLength: true,
	asset: { select: { messageId: true, state: true, artifactId: true, revisionId: true } },
} satisfies Prisma.ConversationGeneratedFileSelect;

type _Operation = Prisma.ConversationGeneratedFileGetPayload<{ select: typeof _OPERATION_SELECT }>;

/** Owns direct relational checks and the once-only generated asset message link. */
export class PrismaConversationGeneratedFileOutputRepository implements GeneratedFileOutputLinkRepository
{
	/** Reuse existing record, result and dispatch owners on this exact transaction. */
	constructor(
		private readonly transaction: Prisma.TransactionClient,
		private readonly generatedResults: ConversationGeneratedFileResultRepository,
		private readonly dispatch: ConversationToolSystemExecutionAdmissionAuthority,
	) {}

	/** Recover the exact saved link, or establish it once while the original execution remains current. */
	async link(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const artifact = __ReadConversationGeneratedFileOutput(turn);
		if (artifact === null || turn.outputReceipt === null || turn.toolSelection === null)
			throw new Error("Generated file output has no saved Artifact");
		const entry = turn.outputReceipt.event.data.entry;
		if (turn.outputSourceCommandId !== entry.id || turn.outputReceipt.event.id !== entry.id || entry.idempotencyKey !== entry.id)
			throw new Error("Generated file output message identity is invalid");

		const operation = await this.transaction.conversationGeneratedFile.findUnique({ where: { assetId: artifact.id }, select: _OPERATION_SELECT });
		if (operation === null || !_OperationMatches(operation, turn, artifact))
			throw new Error("Generated file output does not match its captured operation");
		const invocation = await __FindToolInvocationInTransaction(this.transaction, operation.toolInvocationRowId);
		const record = await new PrismaConversationGeneratedFileRecordRepository(this.transaction).load(operation.id, operation.siloId);
		if (invocation === null || !_SavedInvocationMatches(operation, invocation) || record.snapshot.state !== GeneratedFileWorkflowStates.Ready)
			throw new Error("Generated file output does not match its saved invocation");
		if (operation.asset.messageId === entry.id)
			return;
		if (operation.asset.messageId !== null)
			throw new Error("Generated file output is already linked to another message");

		const result = await __ReadRunToolResultInTransaction(this.transaction, {
			siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt,
			toolInvocationId: turn.toolSelection.proposalId, runtimeInstanceId: turn.computerId,
			commandId: turn.bootstrapId, requestFingerprint: turn.toolSelection.requestFingerprint,
		});
		if (result.outcome !== RunToolResultReadOutcomes.Available || !result.consumed
			|| result.payloadDigest !== turn.continuationReservation?.resultDigest)
			throw new Error("Generated file output result is no longer available");
		const admission = await this.dispatch.admitSystem(result.invocation, new Date(), CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR);
		if (admission === null)
			throw new Error("Generated file output authority ended before linking");
		const deadline = Math.min(admission.notAfterEpochMs, turn.continuationReservation?.authorityExpiresAtEpochMs ?? 0);
		const current = await this.generatedResults.read({ turn, invocation: result.invocation, payload: result.payload, admission });
		if (current.state !== ConversationGeneratedFileResultStates.Ready || current.operationId !== operation.id
			|| ___DigestCanonicalJson(current.artifact as unknown as JsonValue) !== ___DigestCanonicalJson(artifact as unknown as JsonValue)
			|| !Number.isSafeInteger(deadline) || Date.now() >= deadline)
			throw new Error("Generated file output no longer matches its Ready result");

		const changed = await this.transaction.conversationAsset.updateMany({
			where: { id: operation.assetId, siloId: operation.siloId, conversationId: operation.conversationId,
				messageId: null, state: ConversationAssetState.Ready, artifactId: operation.artifactId, revisionId: operation.revisionId },
			data: { messageId: entry.id },
		});
		if (Date.now() >= deadline)
			throw new Error("Generated file output authority expired while linking");
		if (changed.count === 1)
			return;
		const winner = await this.transaction.conversationAsset.findUnique({ where: { id: operation.assetId }, select: { messageId: true } });
		if (winner?.messageId !== entry.id)
			throw new Error("Generated file output link changed before commit");
	}
}

/** Bind the saved Artifact block to every immutable operation and turn coordinate. */
function _OperationMatches(operation: _Operation, turn: FrozenConversationComputerTurn, artifact: ReturnType<typeof __ReadConversationGeneratedFileOutput>): boolean
{
	return artifact !== null && operation.siloId === turn.siloId && operation.siloId === turn.binding.siloId
		&& operation.conversationId === turn.binding.conversationId && operation.runId === turn.compile.runId
		&& operation.runId === turn.binding.runId && operation.attempt === turn.compile.attempt
		&& operation.bootstrapId === turn.bootstrapId && operation.computerId === turn.computerId
		&& operation.computerId === turn.binding.computerId && operation.leaseId === turn.lease.leaseId
		&& operation.leaseGeneration === turn.lease.leaseGeneration && operation.leaseGeneration === turn.binding.leaseGeneration
		&& operation.agentIdentityId === turn.binding.agentIdentityId && operation.toolInvocationId === turn.toolSelection?.proposalId
		&& operation.assetId === artifact.id && operation.artifactId === artifact.artifactId && operation.revisionId === artifact.artifactRevisionId
		&& operation.displayName === artifact.name && operation.mediaType === artifact.mediaType
		&& operation.asset.state === ConversationAssetState.Ready && operation.asset.artifactId === operation.artifactId
		&& operation.asset.revisionId === operation.revisionId;
}

/** Verify historical invocation coordinates and canonical metadata without granting current authority. */
function _SavedInvocationMatches(operation: _Operation, invocation: NonNullable<Awaited<ReturnType<typeof __FindToolInvocationInTransaction>>>): boolean
{
	if (invocation.result === null)
		return false;
	const canonical = _GeneratedFileCapturedMetadataResult({ kind: GeneratedFileResultKinds.Captured, operationId: operation.id,
		assetId: operation.assetId, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId,
		rawResultDigest: operation.rawResultDigest, displayName: operation.displayName, mediaType: operation.mediaType,
		byteLength: Number(operation.byteLength) });
	return invocation.id === operation.toolInvocationRowId && invocation.siloId === operation.siloId
		&& invocation.runId === operation.runId && invocation.attempt === operation.attempt
		&& invocation.toolInvocationId === operation.toolInvocationId && invocation.toolRevisionId === operation.toolRevisionId
		&& invocation.requestIdentity.runtimeInstanceId === operation.computerId && invocation.requestIdentity.commandId === operation.bootstrapId
		&& invocation.state === ToolInvocationStates.Succeeded
		&& ___DigestCanonicalJson(invocation.result as unknown as JsonValue) === ___DigestCanonicalJson(canonical as unknown as JsonValue);
}
