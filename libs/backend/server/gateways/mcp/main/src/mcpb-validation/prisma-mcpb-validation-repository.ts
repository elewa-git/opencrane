import { createHash } from "node:crypto";

import { McpbValidationWorkloadState, Prisma } from "@prisma/client";
import type { McpbValidationState } from "@prisma/client";

import { McpbValidationStates } from "./mcpb-validation.types";
import type { McpbVerificationFailureCodes, McpbVerificationResult } from "./mcpb-validation.types";
import type { McpbValidationCreateResult, McpbValidationRecord, McpbValidationRepository, McpbValidationSubmissionRecord, McpbValidationWorkloadAssignment, McpbValidationWorkloadClaim, McpbValidationWorkloadTask, McpbValidationWriteResult } from "./mcpb-validation-repository.types";

/** Product fields returned after every MCP bundle validation read or write. */
const _VALIDATION_SELECT = { id: true, siloId: true, artifactId: true, artifactRevisionId: true, contentAddress: true, byteLength: true, mediaType: true, submissionDigest: true, state: true, manifestName: true, bundleVersion: true, manifestDigest: true, publisher: true, signerFingerprint: true, failureCode: true } as const satisfies Prisma.McpbValidationSelect;

/** Prisma projection returned for the bounded MCP bundle validation selection. */
type _ValidationProjection = Prisma.McpbValidationGetPayload<{ select: typeof _VALIDATION_SELECT }>;

/** Fields needed to fence one controller claim without returning bundle or task input. */
const _WORKLOAD_CLAIM_SELECT = { id: true, siloId: true, validationId: true, state: true, claimedAt: true, claimExpiresAt: true, deliveryCount: true, workloadUid: true } as const satisfies Prisma.McpbValidationWorkloadSelect;

/** Prisma projection returned while the controller claims or assigns one validator workload. */
type _WorkloadClaimProjection = Prisma.McpbValidationWorkloadGetPayload<{ select: typeof _WORKLOAD_CLAIM_SELECT }>;

/** Derive the claim identity used to serialize one submission key. */
function _ClaimDigest(submissionKeyDigest: string): string
{
	return `sha256:${createHash("sha256").update(`mcpb-submission:${submissionKeyDigest}`).digest("hex")}`;
}

/** Translate Prisma's saved state before product or workflow code reads it. */
function _State(value: McpbValidationState): McpbValidationStates
{
	if (value === "Pending")
		return McpbValidationStates.Pending;
	if (value === "Verified")
		return McpbValidationStates.Verified;
	if (value === "Rejected")
		return McpbValidationStates.Rejected;
	throw new Error("MCP bundle validation has an unknown state.");
}

/** Map one bounded Prisma projection into the MCP product contract. */
function _Record(value: _ValidationProjection): McpbValidationRecord
{
	if (value.byteLength > BigInt(Number.MAX_SAFE_INTEGER) || value.byteLength < 0n)
		throw new Error("MCP bundle validation has an invalid byte length.");
	return { ...value, byteLength: Number(value.byteLength), state: _State(value.state), failureCode: value.failureCode as McpbVerificationFailureCodes | null };
}

/** Return a controller claim only when every persisted field forms one complete lease. */
function _Claim(value: _WorkloadClaimProjection): McpbValidationWorkloadClaim
{
	if (value.claimedAt === null || value.claimExpiresAt === null || !Number.isSafeInteger(value.deliveryCount) || value.deliveryCount < 1)
		throw new Error("MCP bundle validation workload has an invalid controller claim.");
	return { workloadId: value.id, siloId: value.siloId, validationId: value.validationId, claimedAt: value.claimedAt.toISOString(), deliveryCount: value.deliveryCount, expiresAt: value.claimExpiresAt.toISOString() };
}

/** Reject an assignment before it can select or change any database row. */
function _IsAssignmentValid(workloadId: string, assignment: McpbValidationWorkloadAssignment): boolean
{
	return workloadId.trim().length > 0 && assignment.workloadUid.trim().length > 0 && Number.isSafeInteger(assignment.deliveryCount) && assignment.deliveryCount >= 1 && Number.isFinite(Date.parse(assignment.claimedAt));
}

/** Transaction-scoped Prisma adapter for MCP bundle validation product state. */
export class PrismaMcpbValidationRepository implements McpbValidationRepository
{
	/** Database transaction shared with product writes and workflow admission. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Create an adapter bound to one existing database transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Create a pending validation or return the row already claimed by this request key. */
	async createOrFind(submission: McpbValidationSubmissionRecord): Promise<McpbValidationCreateResult | null>
	{
		await this._transaction.mcpbValidationClaim.upsert({
			where: { siloId_identityDigest: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.submissionKeyDigest) } },
			create: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.submissionKeyDigest) },
			update: { touchedAt: new Date() },
			select: { identityDigest: true },
		});
		const existing = await this._transaction.mcpbValidation.findUnique({ where: { siloId_submissionKeyDigest: { siloId: submission.siloId, submissionKeyDigest: submission.submissionKeyDigest } }, select: _VALIDATION_SELECT });
		if (existing)
		{
			const validation = _Record(existing);
			return validation.submissionDigest === submission.submissionDigest ? { created: false, validation } : null;
		}
		const created = await this._transaction.mcpbValidation.create({ data: submission, select: _VALIDATION_SELECT });
		return { created: true, validation: _Record(created) };
	}

	/** Saves the admitted task once and rejects a retry that names different task facts. */
	async ensureWorkload(siloId: string, validationId: string, task: McpbValidationWorkloadTask): Promise<string | null>
	{
		const existing = await this._transaction.mcpbValidationWorkload.findUnique({ where: { validationId }, select: { id: true, siloId: true, taskId: true, taskName: true, taskKey: true } });
		if (existing)
		{
			if (existing.siloId !== siloId || existing.taskId !== task.taskId || existing.taskName !== task.taskName || existing.taskKey !== task.taskKey)
				return null;
			return existing.id;
		}
		const validation = await this._transaction.mcpbValidation.findFirst({ where: { id: validationId, siloId }, select: { id: true } });
		if (validation === null)
			return null;
		const workload = await this._transaction.mcpbValidationWorkload.create({ data: { siloId, validationId, taskId: task.taskId, taskName: task.taskName, taskKey: task.taskKey }, select: { id: true } });
		return workload.id;
	}

	/** Claim one pending or expired workload for the bounded controller lease. */
	async claimNextWorkload(leaseMilliseconds: number): Promise<McpbValidationWorkloadClaim | null>
	{
		if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1 || leaseMilliseconds > 300_000)
			throw new Error("MCP bundle validation workload claim lease must be bounded.");
		const claimedAt = new Date();
		const candidate = await this._transaction.mcpbValidationWorkload.findFirst({
			where: { OR: [{ state: McpbValidationWorkloadState.Pending }, { state: McpbValidationWorkloadState.Claimed, claimExpiresAt: { lte: claimedAt } }] },
			orderBy: { createdAt: "asc" },
			select: _WORKLOAD_CLAIM_SELECT,
		});
		if (candidate === null)
			return null;
		const claimExpiresAt = new Date(claimedAt.getTime() + leaseMilliseconds);
		const deliveryCount = candidate.deliveryCount + 1;
		const updated = await this._transaction.mcpbValidationWorkload.updateMany({
			where: { id: candidate.id, state: candidate.state, claimedAt: candidate.claimedAt, claimExpiresAt: candidate.claimExpiresAt, deliveryCount: candidate.deliveryCount, workloadUid: null },
			data: { state: McpbValidationWorkloadState.Claimed, claimedAt, claimExpiresAt, deliveryCount },
		});
		if (updated.count !== 1)
			return null;
		const claimed = await this._transaction.mcpbValidationWorkload.findUnique({ where: { id: candidate.id }, select: _WORKLOAD_CLAIM_SELECT });
		if (claimed === null || claimed.state !== McpbValidationWorkloadState.Claimed || claimed.deliveryCount !== deliveryCount)
			return null;
		return _Claim(claimed);
	}

	/** Record the Kubernetes Job UID only while the controller's original claim is still valid. */
	async commitWorkloadAssignment(workloadId: string, assignment: McpbValidationWorkloadAssignment): Promise<"assigned" | "idempotent" | "conflict">
	{
		if (!_IsAssignmentValid(workloadId, assignment))
			return "conflict";
		const workload = await this._transaction.mcpbValidationWorkload.findUnique({ where: { id: workloadId }, select: _WORKLOAD_CLAIM_SELECT });
		if (workload === null)
			return "conflict";
		if (workload.state === McpbValidationWorkloadState.Assigned)
			return workload.workloadUid === assignment.workloadUid && workload.claimedAt?.getTime() === Date.parse(assignment.claimedAt) && workload.deliveryCount === assignment.deliveryCount ? "idempotent" : "conflict";
		if (workload.state !== McpbValidationWorkloadState.Claimed || workload.claimedAt?.getTime() !== Date.parse(assignment.claimedAt) || workload.claimExpiresAt === null || workload.deliveryCount !== assignment.deliveryCount || Date.now() >= workload.claimExpiresAt.getTime())
			return "conflict";
		const updated = await this._transaction.mcpbValidationWorkload.updateMany({
			where: { id: workloadId, state: McpbValidationWorkloadState.Claimed, claimedAt: workload.claimedAt, claimExpiresAt: workload.claimExpiresAt, deliveryCount: workload.deliveryCount, workloadUid: null },
			data: { state: McpbValidationWorkloadState.Assigned, workloadUid: assignment.workloadUid },
		});
		return updated.count === 1 ? "assigned" : "conflict";
	}

	/** Find one validation only inside the authenticated silo. */
	async find(siloId: string, validationId: string): Promise<McpbValidationRecord | null>
	{
		const validation = await this._transaction.mcpbValidation.findFirst({ where: { id: validationId, siloId }, select: _VALIDATION_SELECT });
		return validation ? _Record(validation) : null;
	}

	/** Load one exact saved validation for task replay. */
	async load(siloId: string, validationId: string, submissionDigest: string): Promise<McpbValidationRecord | null>
	{
		const validation = await this._transaction.mcpbValidation.findFirst({ where: { id: validationId, siloId, submissionDigest }, select: _VALIDATION_SELECT });
		return validation ? _Record(validation) : null;
	}

	/** Save one pending verification answer or return the answer already stored by a replay. */
	async recordResult(siloId: string, validationId: string, submissionDigest: string, result: McpbVerificationResult): Promise<McpbValidationWriteResult | null>
	{
		const data: Prisma.McpbValidationUpdateManyMutationInput = result.accepted
			? { state: McpbValidationStates.Verified, manifestName: result.manifest.name, bundleVersion: result.manifest.version, manifestDigest: result.manifest.manifestDigest, publisher: result.manifest.publisher, signerFingerprint: result.manifest.signerFingerprint, failureCode: null, completedAt: new Date() }
			: { state: McpbValidationStates.Rejected, manifestName: null, bundleVersion: null, manifestDigest: null, publisher: null, signerFingerprint: null, failureCode: result.failureCode, completedAt: new Date() };
		const changed = await this._transaction.mcpbValidation.updateMany({ where: { id: validationId, siloId, submissionDigest, state: McpbValidationStates.Pending }, data });
		const validation = await this._transaction.mcpbValidation.findFirst({ where: { id: validationId, siloId, submissionDigest }, select: _VALIDATION_SELECT });
		return validation ? { changed: changed.count === 1, validation: _Record(validation) } : null;
	}
}
