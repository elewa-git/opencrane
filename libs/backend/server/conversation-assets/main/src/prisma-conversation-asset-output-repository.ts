import { randomUUID } from "node:crypto";

import { ArtifactKind, ArtifactRevisionState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, ConversationLifecycle, ConversationTimelineEntryKind, WorkloadAssignmentState, type Prisma } from "@prisma/client";

import type { ArtifactPromotionReceiptClaims } from "@opencrane/backend/artifacts/authorization";
import { ConversationAssetScanLifecycleStates } from "@opencrane/backend/server/agents/artifacts";
import { ___DecideConversationAssetBatch } from "@opencrane/models/conversation-assets";
import { ConversationSystemEventTypes } from "@opencrane/models/conversations";
import { ConversationAssetOutputDenialReasons, ConversationAssetOutputPublishOutcomes, ConversationAssetOutputReservationOutcomes, ConversationAssetOutputTargetStatuses, type ConversationAssetOutputRepository, type ConversationAssetOutputReservationResult, type ConversationAssetOutputRuntimeIdentity, type ConversationAssetOutputTarget, type ConversationAssetOutputPublishResult, type ReserveConversationAssetOutput } from "./conversation-asset-output.types.js";

/** Persisted runtime-event value owned by the execution authority but referenced through its database contract. */
const _MESSAGE_STARTED_EVENT_TYPE = "message.started";

/** Transaction-scoped authority for one retry-stable generated conversation output. */
export class PrismaConversationAssetOutputRepository implements ConversationAssetOutputRepository
{
	/** Transaction client that atomically owns the complete generated-output aggregate. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds generated-output operations to an already-open transaction. */
	constructor(transaction: Prisma.TransactionClient) { this.transaction = transaction; }

	/** Atomically creates the ticket, generated artifact, exact write lease, and hidden asset row. */
	async reserve(identity: ConversationAssetOutputRuntimeIdentity, command: ReserveConversationAssetOutput): Promise<ConversationAssetOutputReservationResult>
	{
		// 1. Rebind caller metadata to the live runtime assignment and canonical assistant message event.
		const assignment = await this._assignment(identity, command.runId, command.runAttempt);
		const messageStarted = assignment === null || assignment.run.conversationId === null ? null : await this._messageStarted(assignment.run.conversationId, command);
		if (assignment === null || assignment.run.conversationId === null || messageStarted === null) return { outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.RuntimeUnavailable };
		// 2. Resolve the immutable retry coordinate before creating any new write authority.
		const existing = await this.transaction.conversationAssetOutputTicket.findUnique({ where: { runId_runAttempt_idempotencyKey: { runId: command.runId, runAttempt: command.runAttempt, idempotencyKey: command.idempotencyKey } }, include: { asset: { include: { uploadLease: true } } } });
		if (existing !== null)
		{
			return existing.asset !== null && _ReservationMatches(existing, existing.asset, command)
				? { outcome: ConversationAssetOutputReservationOutcomes.Idempotent, ticketId: existing.id }
				: { outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.OutputConflict };
		}
		// 3. Apply the approved count, media, and 200 MiB total policy to this whole assistant message.
		const messageAssets = await this.transaction.conversationAsset.findMany({ where: { conversationId: assignment.run.conversationId, runId: command.runId, runAttempt: command.runAttempt, runMessageId: command.messageId, provenance: ConversationAssetProvenance.AgentOutput }, select: { mediaType: true, byteLength: true } });
		const batch = messageAssets.map(function _File(asset) { return { mediaType: asset.mediaType, byteLength: Number(asset.byteLength ?? 0n) }; });
		if (!___DecideConversationAssetBatch([...batch, { mediaType: command.mediaType, byteLength: command.byteLength }]).accepted) return { outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.InvalidRequest };
		const ticketId = randomUUID();
		const artifactId = randomUUID();
		const leaseId = randomUUID();
		// 4. Create the ticket, artifact, exact-content lease, and hidden browser asset in one transaction.
		await this.transaction.conversationAssetOutputTicket.create({ data: { id: ticketId, siloId: assignment.siloId, conversationId: assignment.run.conversationId, runId: command.runId, runAttempt: command.runAttempt, runEventSequence: messageStarted.sequence, outputMessageId: command.messageId, idempotencyKey: command.idempotencyKey, expiresAt: assignment.expiresAt } });
		await this.transaction.artifact.create({ data: { id: artifactId, siloId: assignment.siloId, ownerPrincipalId: assignment.subjectId, kind: ArtifactKind.Generated } });
		await this.transaction.artifactUploadLease.create({ data: { id: leaseId, artifactId, siloId: assignment.siloId, capabilityJti: randomUUID(), expectedContentAddress: command.contentAddress, expectedByteLength: BigInt(command.byteLength), mediaType: command.mediaType, expiresAt: assignment.expiresAt } });
		await this.transaction.conversationAsset.create({ data: { id: randomUUID(), siloId: assignment.siloId, conversationId: assignment.run.conversationId, runId: command.runId, runAttempt: command.runAttempt, runEventSequence: messageStarted.sequence, runMessageId: command.messageId, artifactId, uploadLeaseId: leaseId, outputTicketId: ticketId, idempotencyKey: command.idempotencyKey, provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading, displayName: command.displayName.trim(), mediaType: command.mediaType, byteLength: BigInt(command.byteLength) } });
		return { outcome: ConversationAssetOutputReservationOutcomes.Issued, ticketId };
	}

	/** Returns a live server-only lease only to the exact registered runtime assignment. */
	async readUploadTarget(identity: ConversationAssetOutputRuntimeIdentity, ticketId: string): Promise<ConversationAssetOutputTarget | null>
	{
		const ticket = await this.transaction.conversationAssetOutputTicket.findUnique({ where: { id: ticketId }, include: { asset: { include: { uploadLease: true } } } });
		if (ticket === null || ticket.asset === null) return null;
		const assignment = await this._assignment(identity, ticket.runId, ticket.runAttempt);
		if (assignment === null) return null;
		if (ticket.finalizedAt !== null) return { status: ConversationAssetOutputTargetStatuses.Completed };
		const lease = ticket.asset.uploadLease;
		if (ticket.expiresAt <= new Date() || lease === null || lease.state !== ArtifactUploadLeaseState.Active || lease.expiresAt <= new Date() || lease.expectedContentAddress === null || lease.expectedByteLength === null) return null;
		return { status: ConversationAssetOutputTargetStatuses.Issued, lease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress, expectedByteLength: Number(lease.expectedByteLength), mediaType: lease.mediaType } };
	}

	/** Commits a verified promotion as one quarantined revision and one pending scan. */
	async finalize(identity: ConversationAssetOutputRuntimeIdentity, ticketId: string, promotion: ArtifactPromotionReceiptClaims, receiptDigest: string): Promise<ConversationAssetOutputPublishResult>
	{
		// 1. Lock finalization onto the server-issued ticket aggregate and its current asset state.
		const ticket = await this.transaction.conversationAssetOutputTicket.findUnique({ where: { id: ticketId }, include: { asset: true } });
		if (ticket === null || ticket.asset === null) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.OutputUnavailable };
		const assignment = await this._assignment(identity, ticket.runId, ticket.runAttempt);
		if (assignment === null) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.RuntimeUnavailable };
		if (ticket.finalizedAt !== null) return { outcome: ConversationAssetOutputPublishOutcomes.Idempotent };
		const asset = ticket.asset;
		if (ticket.expiresAt <= new Date() || asset.state !== ConversationAssetState.Uploading || asset.uploadLeaseId !== promotion.leaseId || asset.artifactId === null) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.OutputUnavailable };
		// 2. Revalidate the exact active lease against the cryptographically verified receipt.
		const lease = await this.transaction.artifactUploadLease.findUnique({ where: { id: promotion.leaseId } });
		if (lease === null || lease.state !== ArtifactUploadLeaseState.Active || lease.expiresAt <= new Date() || lease.expectedContentAddress !== promotion.contentAddress || lease.expectedByteLength !== BigInt(promotion.byteLength) || lease.mediaType !== promotion.mediaType) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.UploadFailed };
		const now = new Date();
		const revisionId = randomUUID();
		// 3. Persist immutable receipt evidence, run provenance, quarantine, and scan work atomically.
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, promotionReceiptDigest: receiptDigest, promotedContentAddress: promotion.contentAddress, promotedByteLength: BigInt(promotion.byteLength), promotedAt: now, finalizedAt: now } });
		await this.transaction.artifactRevision.create({ data: { id: revisionId, artifactId: asset.artifactId, revision: 1, state: ArtifactRevisionState.Quarantined, contentAddress: promotion.contentAddress, byteLength: BigInt(promotion.byteLength), mediaType: promotion.mediaType, provenance: { kind: "conversation_agent_output", conversationAssetId: asset.id, outputTicketId: ticket.id, runEventSequence: ticket.runEventSequence }, sourceRunId: ticket.runId, sourceMessageId: ticket.outputMessageId, createdBy: assignment.subjectId } });
		await this.transaction.artifactScanJob.create({ data: { artifactRevisionId: revisionId } });
		await this.transaction.conversationAssetOutputTicket.update({ where: { id: ticket.id }, data: { finalizedContentAddress: promotion.contentAddress, finalizedReceiptDigest: receiptDigest, finalizedAt: now } });
		await this.transaction.conversationAsset.update({ where: { id: asset.id }, data: { revisionId, state: ConversationAssetState.Processing } });
		await this._appendAssetsChanged(asset.conversationId, asset.id, "processing");
		return { outcome: ConversationAssetOutputPublishOutcomes.Accepted };
	}

	/** Commit one scanner-selected terminal state and publish a payload-free list invalidation. */
	async report(command: { readonly revisionId: string; readonly state: ConversationAssetScanLifecycleStates; readonly failureCode: "unsafe_file" | "scan_failed" | null }): Promise<void>
	{
		const asset = await this.transaction.conversationAsset.findFirst({ where: { revisionId: command.revisionId, state: ConversationAssetState.Processing }, select: { id: true, conversationId: true } });
		if (asset === null) return;
		const state = command.state === ConversationAssetScanLifecycleStates.Ready ? ConversationAssetState.Ready : ConversationAssetState.Failed;
		const changed = await this.transaction.conversationAsset.updateMany({ where: { id: asset.id, revisionId: command.revisionId, state: ConversationAssetState.Processing }, data: { state, failureCode: command.failureCode } });
		if (changed.count === 1) await this._appendAssetsChanged(asset.conversationId, asset.id, command.state);
	}

	/** Requires the exact live attempt and exact projected pod identity on every operation. */
	private async _assignment(identity: ConversationAssetOutputRuntimeIdentity, runId: string, runAttempt: number)
	{
		return this.transaction.workloadAssignment.findFirst({ where: { runId, attempt: runAttempt, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, podUid: identity.podUid, state: WorkloadAssignmentState.Registered, expiresAt: { gt: new Date() }, run: { attempt: runAttempt } }, include: { run: true } });
	}

	/** Requires the canonical assistant message-start coordinate owned by this run. */
	private async _messageStarted(conversationId: string, command: ReserveConversationAssetOutput): Promise<{ readonly sequence: number } | null>
	{
		const event = await this.transaction.conversationRunEvent.findFirst({ where: { conversationId, runId: command.runId, type: _MESSAGE_STARTED_EVENT_TYPE, messageId: command.messageId }, select: { sequence: true, payload: true } });
		return event !== null && _MessagePayloadMatches(event.payload, command.messageId) ? { sequence: event.sequence } : null;
	}

	/** Append one stable list invalidation only while the conversation remains open. */
	private async _appendAssetsChanged(conversationId: string, assetId: string, phase: "processing" | "ready" | "failed"): Promise<void>
	{
		const conversation = await this.transaction.conversation.findUnique({ where: { id: conversationId }, select: { lifecycle: true } });
		if (conversation?.lifecycle !== ConversationLifecycle.Open) return;
		await this.transaction.conversationTimelineEntry.create({ data: { conversationId, kind: ConversationTimelineEntryKind.System, systemEventId: `conversation-asset:${assetId}:${phase}`, payload: { eventType: ConversationSystemEventTypes.AssetsChanged } } });
	}
}

/** Require an exact retry body against the server-owned ticket aggregate. */
function _ReservationMatches(ticket: { readonly outputMessageId: string }, asset: { readonly displayName: string; readonly mediaType: string; readonly byteLength: bigint | null; readonly uploadLease: { readonly expectedContentAddress: string | null } | null }, command: ReserveConversationAssetOutput): boolean
{
	return ticket.outputMessageId === command.messageId && asset.displayName === command.displayName.trim() && asset.mediaType === command.mediaType && asset.byteLength === BigInt(command.byteLength) && asset.uploadLease?.expectedContentAddress === command.contentAddress;
}

/** Validate the exact persisted message-start payload without trusting caller metadata. */
function _MessagePayloadMatches(value: Prisma.JsonValue, messageId: string): boolean
{
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 2 && value["messageId"] === messageId && value["role"] === "assistant";
}
