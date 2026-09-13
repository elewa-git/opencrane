import { ArtifactQuarantineOutcomes } from "@opencrane/backend/server/agents/artifacts";
import type { ConversationToolDispatchAdmission } from "@opencrane/backend/server/conversations";
import { ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ConversationAssetState, type Prisma } from "@prisma/client";
import { ___GeneratedFileEventName } from "@opencrane/contracts";

import { __OpenGeneratedFile } from "../../custody/file-custody";
import type { GeneratedFilePromotionAuthorityCommand, GeneratedFilePromotionAuthorityEvidence } from "../../promotion/generated-file-promotion.types";
import { GeneratedFileQuarantineOutcomes, GeneratedFileWorkflowStates, type GeneratedFilePromotionReceipt, type GeneratedFileWorkflowSnapshot } from "../../workflow/generated-file-workflow.types";
import type { ConversationGeneratedFileTaskInput } from "../generated-file-capture.types";
import { CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR, GeneratedFileWorkflowFailureCodes, type GeneratedFileWorkflowPersistenceDependencies, type GeneratedFileWorkflowRecord, type GeneratedFileWorkflowRecordRepository, type GeneratedFileWorkflowRepository } from "./generated-file-workflow-persistence.types";
import { PrismaConversationGeneratedFileRecordRepository } from "./prisma-conversation-generated-file-record-repository";

/** Transaction-bound owner for generated-file state, current authority, custody and task wakes. */
export class PrismaConversationGeneratedFileWorkflowRepository implements GeneratedFileWorkflowRepository
{
	/** Transaction-bound reader that validates cross-owner relational state before this owner acts. */
	private readonly records: GeneratedFileWorkflowRecordRepository;

	/** Keep every state read, authority decision, lifecycle write and event on this transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: GeneratedFileWorkflowPersistenceDependencies)
	{
		this.records = new PrismaConversationGeneratedFileRecordRepository(this.transaction);
	}

	/** Reload current state and durably close nonterminal work when its original authority ended. */
	async loadCurrent(input: ConversationGeneratedFileTaskInput, task: IWorkflowTaskReceipt, now: Date): Promise<GeneratedFileWorkflowSnapshot | null>
	{
		_RequireNow(now);
		const record = await this.records.load(input.operationId, input.siloId);
		_RequireTask(record, task);
		const snapshot = record.snapshot;
		if (snapshot.state === GeneratedFileWorkflowStates.Ready || snapshot.state === GeneratedFileWorkflowStates.Failed)
			return snapshot;
		return this._AuthorizeOrFail(record, snapshot, now);
	}

	/** Recheck the same immutable snapshot and reconstruct bytes only after every custody row verifies. */
	async openVerifiedBytes(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, now: Date): Promise<Uint8Array | null>
	{
		_RequireNow(now);
		const record = await this.records.load(snapshot.operationId, snapshot.siloId);
		_RequireTask(record, task);
		const current = await this._AuthorizeOrFail(record, record.snapshot, now);
		if (current === null)
			return null;
		_RequireSnapshot(snapshot, current, GeneratedFileWorkflowStates.PromotionRequired);
		return this._OpenCustody(record);
	}

	/** Admit the checkpointed receipt to quarantine and advance the asset in this same transaction. */
	async finalizeQuarantine(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, receipt: GeneratedFilePromotionReceipt, now: Date): Promise<GeneratedFileQuarantineOutcomes>
	{
		_RequireNow(now);
		_RequireReceipt(snapshot, receipt);
		const record = await this.records.load(snapshot.operationId, snapshot.siloId);
		_RequireTask(record, task);
		const projected = record.snapshot;
		_RequireSnapshotIdentity(snapshot, projected);
		if (projected.state === GeneratedFileWorkflowStates.Ready)
			return _RequireSavedReceipt(record, receipt);
		if (projected.state === GeneratedFileWorkflowStates.Failed)
		{
			if (record.failureCode === GeneratedFileWorkflowFailureCodes.AuthorityEnded)
				return GeneratedFileQuarantineOutcomes.AuthorityEnded;
			return _RequireSavedReceipt(record, receipt);
		}

		const current = await this._AuthorizeOrFail(record, projected, now);
		if (current === null)
			return GeneratedFileQuarantineOutcomes.AuthorityEnded;
		if (projected.state === GeneratedFileWorkflowStates.ScanPending)
			return _RequireSavedReceipt(record, receipt);
		_RequireSnapshot(snapshot, current, GeneratedFileWorkflowStates.PromotionRequired);
		const quarantine = this.dependencies.artifactQuarantine(this.transaction);
		const command = {
			siloId: record.snapshot.siloId, artifactId: record.snapshot.artifactId,
			artifactRevisionId: record.snapshot.artifactRevisionId, createdBy: record.requesterSubjectId,
			provenance: { kind: "conversation_generated_file", operationId: record.snapshot.operationId },
			promotion: receipt,
		};
		const outcome = await quarantine.finalize(command);
		if (outcome === ArtifactQuarantineOutcomes.Denied)
			throw new Error("Generated file quarantine denied the verified promotion");
		const advanced = await this.transaction.conversationAsset.updateMany({
			where: { id: record.assetId, siloId: record.snapshot.siloId, artifactId: record.snapshot.artifactId, uploadLeaseId: record.snapshot.uploadLeaseId, revisionId: null, state: ConversationAssetState.Uploading },
			data: { revisionId: record.snapshot.artifactRevisionId, state: ConversationAssetState.Processing },
		});
		if (advanced.count === 1)
			return outcome === ArtifactQuarantineOutcomes.Accepted ? GeneratedFileQuarantineOutcomes.Advanced : GeneratedFileQuarantineOutcomes.Idempotent;
		if (outcome === ArtifactQuarantineOutcomes.Accepted)
			throw new Error("Generated file quarantine lost the asset transition");
		const winner = await this.records.load(snapshot.operationId, snapshot.siloId);
		const winnerState = winner.snapshot.state;
		if (!_SavedReceiptMatches(winner, receipt) || ![GeneratedFileWorkflowStates.ScanPending, GeneratedFileWorkflowStates.Ready, GeneratedFileWorkflowStates.Failed].includes(winnerState))
			throw new Error("Generated file quarantine replay conflicted");
		return GeneratedFileQuarantineOutcomes.Idempotent;
	}

	/** Return the original exact write lease after rechecking the same current execution. */
	async admitCurrent(command: GeneratedFilePromotionAuthorityCommand, now: Date): Promise<GeneratedFilePromotionAuthorityEvidence | null>
	{
		_RequireNow(now);
		const record = await this.records.load(command.operationId, command.siloId);
		const projected = record.snapshot;
		const current = await this._AuthorizeOrFail(record, projected, now);
		if (current === null)
			return null;
		_RequirePromotionCommand(command, current);
		if (!record.uploadLeaseActive)
			throw new Error("Generated file fixed upload lease is unavailable");
		return { lease: record.uploadLease, notAfterEpochMs: current.notAfterEpochMs };
	}

	/** Emit both operation-scoped terminal wakes after a scanner transaction saves its verdict. */
	async emitTerminal(operationId: string): Promise<void>
	{
		const record = await this.records.load(operationId);
		const snapshot = record.snapshot;
		if (snapshot.state !== GeneratedFileWorkflowStates.Ready && snapshot.state !== GeneratedFileWorkflowStates.Failed)
			throw new Error("Generated file terminal event requires a terminal asset");
		await this._EmitTerminal(record, snapshot.state);
	}

	/** Reuse IAM and conversations owners, then bind their current answer to the captured operation. */
	private async _AuthorizeOrFail(record: GeneratedFileWorkflowRecord, snapshot: GeneratedFileWorkflowSnapshot, now: Date): Promise<GeneratedFileWorkflowSnapshot | null>
	{
		if (snapshot.state !== GeneratedFileWorkflowStates.PromotionRequired && snapshot.state !== GeneratedFileWorkflowStates.ScanPending)
			throw new Error("Generated file current authority requires nonterminal work");
		const invocation = await this.dependencies.toolInvocations.__ForTransaction(this.transaction).findById(record.invocationRowId);
		if (invocation !== null && !_InvocationMatches(record, invocation))
			throw new Error("Generated file invocation evidence conflicted");
		const admission = invocation === null ? null : await this.dependencies.conversationAdmission(this.transaction).admitSystem(invocation, now, CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR);
		if (admission === null || !_AdmissionMatches(record, admission) || snapshot.notAfterEpochMs <= now.getTime())
		{
			await this._FailAndEmit(record);
			return null;
		}
		const notAfterEpochMs = Math.min(snapshot.notAfterEpochMs, admission.notAfterEpochMs);
		if (!Number.isSafeInteger(notAfterEpochMs) || notAfterEpochMs <= now.getTime())
		{
			await this._FailAndEmit(record);
			return null;
		}
		return { ...snapshot, notAfterEpochMs };
	}

	/** Fail unfinished work and wake both saved task owners in this transaction. */
	private async _FailAndEmit(record: GeneratedFileWorkflowRecord): Promise<void>
	{
		const failed = await this.transaction.conversationAsset.updateMany({
			where: { id: record.assetId, siloId: record.snapshot.siloId, artifactId: record.snapshot.artifactId, state: { in: [ConversationAssetState.Uploading, ConversationAssetState.Processing] } },
			data: { state: ConversationAssetState.Failed, failureCode: GeneratedFileWorkflowFailureCodes.AuthorityEnded },
		});
		if (failed.count !== 1)
			throw new Error("Generated file authority loss lost the asset transition");
		await this._EmitTerminal(record, GeneratedFileWorkflowStates.Failed);
	}

	/** Deliver one metadata-only event separately to generated and parent task receipts. */
	private async _EmitTerminal(record: GeneratedFileWorkflowRecord, state: GeneratedFileWorkflowStates.Ready | GeneratedFileWorkflowStates.Failed): Promise<void>
	{
		const payload = { operationId: record.snapshot.operationId, state };
		const event = { eventName: ___GeneratedFileEventName(record.snapshot.operationId), payload };
		await this.dependencies.workflows.emitEventInTransaction({ client: this.transaction }, record.task, event);
		await this.dependencies.turnEvents(this.transaction).emit(record.runId, record.attempt, event);
	}

	/** Load exact encrypted rows and let the established custody codec verify all bytes. */
	private async _OpenCustody(record: GeneratedFileWorkflowRecord): Promise<Uint8Array>
	{
		const custody = await this.records.loadCustody(record);
		return __OpenGeneratedFile(this.dependencies.custodyCipher, custody.manifest, custody.chunks);
	}
}

/** Require one saved generated task receipt and reject a substituted runner. */
function _RequireTask(record: GeneratedFileWorkflowRecord, task: IWorkflowTaskReceipt): void
{
	if (task.taskId !== record.task.taskId || task.taskName !== record.task.taskName || task.idempotencyKey !== record.task.idempotencyKey)
		throw new Error("Generated file workflow task receipt conflicted");
}

/** Require the authorization-owned invocation to be the completed captured call. */
function _InvocationMatches(record: GeneratedFileWorkflowRecord, invocation: { readonly id: string; readonly siloId: string; readonly runId: string | null; readonly attempt: number | null; readonly toolInvocationId: string; readonly toolRevisionId: string; readonly state: ToolInvocationStates }): boolean
{
	return invocation.id === record.invocationRowId && invocation.siloId === record.snapshot.siloId && invocation.runId === record.runId
		&& invocation.attempt === record.attempt && invocation.toolInvocationId === record.invocationId
		&& invocation.toolRevisionId === record.toolRevisionId && invocation.state === ToolInvocationStates.Succeeded;
}

/** Bind the existing dispatch admission to all captured personal execution coordinates. */
function _AdmissionMatches(record: GeneratedFileWorkflowRecord, admission: ConversationToolDispatchAdmission | null): boolean
{
	if (admission === null || !("proxiedPrincipalId" in admission.identity))
		return false;
	const subject = admission.subject;
	return admission.conversationId === record.conversationId && admission.requesterSubjectId === record.requesterSubjectId
		&& admission.identity.id === record.agentIdentityId
		&& admission.identity.proxiedPrincipalId === record.requesterPrincipalId && subject.siloId === record.snapshot.siloId
		&& subject.agentIdentityId === record.agentIdentityId && subject.requester.requesterPrincipalId === record.requesterPrincipalId
		&& subject.runScope.runId === record.runId && subject.runScope.attempt === record.attempt
		&& subject.computerScope.computerId === record.computerId && subject.computerScope.leaseId === record.computerLeaseId
		&& subject.computerScope.leaseGeneration === record.computerLeaseGeneration;
}

/** Require an unchanged snapshot and its expected lifecycle state before an effect. */
function _RequireSnapshot(expected: GeneratedFileWorkflowSnapshot, current: GeneratedFileWorkflowSnapshot, state: GeneratedFileWorkflowStates): void
{
	_RequireSnapshotIdentity(expected, current);
	if (expected.state !== state || current.state !== state || expected.notAfterEpochMs !== current.notAfterEpochMs)
		throw new Error("Generated file workflow snapshot is stale");
}

/** Compare every immutable operation and Artifact coordinate while allowing lifecycle progress. */
function _RequireSnapshotIdentity(expected: GeneratedFileWorkflowSnapshot, current: GeneratedFileWorkflowSnapshot): void
{
	if (expected.siloId !== current.siloId || expected.operationId !== current.operationId || expected.artifactId !== current.artifactId
		|| expected.artifactRevisionId !== current.artifactRevisionId || expected.uploadLeaseId !== current.uploadLeaseId
		|| expected.contentAddress !== current.contentAddress || expected.byteLength !== current.byteLength || expected.mediaType !== current.mediaType)
		throw new Error("Generated file workflow snapshot conflicted");
}

/** Check the metadata-only promotion authority command against the current workflow snapshot. */
function _RequirePromotionCommand(command: GeneratedFilePromotionAuthorityCommand, current: GeneratedFileWorkflowSnapshot): void
{
	if (current.state !== GeneratedFileWorkflowStates.PromotionRequired || command.notAfterEpochMs !== current.notAfterEpochMs)
		throw new Error("Generated file promotion authority command is stale");
	_RequireSnapshotIdentity({ ...current, ...command, state: current.state }, current);
}

/** Require checkpoint receipt metadata to remain exactly bound to the immutable snapshot. */
function _RequireReceipt(snapshot: GeneratedFileWorkflowSnapshot, receipt: GeneratedFilePromotionReceipt): void
{
	if (receipt.leaseId !== snapshot.uploadLeaseId || receipt.contentAddress !== snapshot.contentAddress
		|| receipt.byteLength !== snapshot.byteLength || receipt.mediaType !== snapshot.mediaType || !/^sha256:[0-9a-f]{64}$/u.test(receipt.receiptDigest))
		throw new Error("Generated file promotion receipt conflicted");
}

/** Compare replay receipt evidence already consumed by the Artifact quarantine owner. */
function _SavedReceiptMatches(record: GeneratedFileWorkflowRecord, receipt: GeneratedFilePromotionReceipt): boolean
{
	return record.savedPromotion !== null && record.savedPromotion.leaseId === receipt.leaseId && record.savedPromotion.receiptDigest === receipt.receiptDigest
		&& record.savedPromotion.contentAddress === receipt.contentAddress && record.savedPromotion.byteLength === receipt.byteLength
		&& record.savedPromotion.mediaType === receipt.mediaType;
}

/** Return the one replay outcome only after exact consumed receipt evidence matches. */
function _RequireSavedReceipt(record: GeneratedFileWorkflowRecord, receipt: GeneratedFilePromotionReceipt): GeneratedFileQuarantineOutcomes.Idempotent
{
	if (!_SavedReceiptMatches(record, receipt))
		throw new Error("Generated file quarantine replay conflicted");
	return GeneratedFileQuarantineOutcomes.Idempotent;
}

/** Require a finite server observation time. */
function _RequireNow(now: Date): void
{
	if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
		throw new Error("Generated file workflow time is invalid");
}
