import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { McpbValidationState } from "@prisma/client";

import { McpbValidationStates } from "./mcpb-validation.types";
import type { McpbVerificationFailureCodes, McpbVerificationResult } from "./mcpb-validation.types";
import type { McpbValidationCreateResult, McpbValidationRecord, McpbValidationRepository, McpbValidationSubmissionRecord, McpbValidationWorkloadTask, McpbValidationWriteResult } from "./mcpb-validation-repository.types";

/** Product fields returned after every MCP bundle validation read or write. */
const _VALIDATION_SELECT = { id: true, siloId: true, artifactId: true, artifactRevisionId: true, contentAddress: true, byteLength: true, mediaType: true, submissionDigest: true, state: true, manifestName: true, bundleVersion: true, manifestDigest: true, publisher: true, signerFingerprint: true, failureCode: true } as const satisfies Prisma.McpbValidationSelect;

/** Prisma projection returned for the bounded MCP bundle validation selection. */
type _ValidationProjection = Prisma.McpbValidationGetPayload<{ select: typeof _VALIDATION_SELECT }>;

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

	/** Save the task-to-worker handoff once, and reject a replay that names different task facts. */
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
