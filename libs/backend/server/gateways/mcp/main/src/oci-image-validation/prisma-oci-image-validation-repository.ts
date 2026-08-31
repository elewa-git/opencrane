import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { OciImageValidationState } from "@prisma/client";

import { OciImageValidationStates } from "./oci-image-validation.types";
import type { OciImageAdmissionResult, OciImageVerificationFailureCodes } from "./oci-image-validation.types";
import type { OciImageValidationCreateResult, OciImageValidationRecord, OciImageValidationRepository, OciImageValidationSubmissionRecord, OciImageValidationWriteResult } from "./oci-image-validation-repository.types";

/** Product fields returned after every OCI image validation read or write. */
const _VALIDATION_SELECT = { id: true, siloId: true, artifactId: true, artifactRevisionId: true, contentAddress: true, byteLength: true, mediaType: true, submissionDigest: true, state: true, indexDigest: true, imageManifestDigest: true, configDigest: true, registryReference: true, failureCode: true } as const satisfies Prisma.OciImageValidationSelect;

/** Prisma projection returned for the bounded OCI image validation selection. */
type _ValidationProjection = Prisma.OciImageValidationGetPayload<{ select: typeof _VALIDATION_SELECT }>;

/** Derive the claim identity used to serialize one submission key. */
function _ClaimDigest(submissionKeyDigest: string): string
{
	return `sha256:${createHash("sha256").update(`oci-image-submission:${submissionKeyDigest}`).digest("hex")}`;
}

/** Translate Prisma's saved state before product or workflow code reads it. */
function _State(value: OciImageValidationState): OciImageValidationStates
{
	if (value === "Pending")
		return OciImageValidationStates.Pending;
	if (value === "Imported")
		return OciImageValidationStates.Imported;
	if (value === "Rejected")
		return OciImageValidationStates.Rejected;
	throw new Error("OCI image validation has an unknown state.");
}

/** Map one bounded Prisma projection into the MCP product contract. */
function _Record(value: _ValidationProjection): OciImageValidationRecord
{
	if (value.byteLength > BigInt(Number.MAX_SAFE_INTEGER) || value.byteLength < 0n)
		throw new Error("OCI image validation has an invalid byte length.");
	return { ...value, byteLength: Number(value.byteLength), state: _State(value.state), failureCode: value.failureCode as OciImageVerificationFailureCodes | null };
}

/** Transaction-scoped Prisma adapter for OCI image validation product state. */
export class PrismaOciImageValidationRepository implements OciImageValidationRepository
{
	/** Database transaction shared with product writes and workflow admission. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Create an adapter bound to one existing database transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Create a pending validation or return the row already claimed by this request key. */
	async createOrFind(submission: OciImageValidationSubmissionRecord): Promise<OciImageValidationCreateResult | null>
	{
		await this._transaction.ociImageValidationClaim.upsert({
			where: { siloId_identityDigest: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.submissionKeyDigest) } },
			create: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.submissionKeyDigest) },
			update: { touchedAt: new Date() },
			select: { identityDigest: true },
		});
		const existing = await this._transaction.ociImageValidation.findUnique({ where: { siloId_submissionKeyDigest: { siloId: submission.siloId, submissionKeyDigest: submission.submissionKeyDigest } }, select: _VALIDATION_SELECT });
		if (existing)
		{
			const validation = _Record(existing);
			return validation.submissionDigest === submission.submissionDigest ? { created: false, validation } : null;
		}
		const created = await this._transaction.ociImageValidation.create({ data: submission, select: _VALIDATION_SELECT });
		return { created: true, validation: _Record(created) };
	}

	/** Find one validation only inside the authenticated silo. */
	async find(siloId: string, validationId: string): Promise<OciImageValidationRecord | null>
	{
		const validation = await this._transaction.ociImageValidation.findFirst({ where: { id: validationId, siloId }, select: _VALIDATION_SELECT });
		return validation ? _Record(validation) : null;
	}

	/** Load one exact saved validation for task replay. */
	async load(siloId: string, validationId: string, submissionDigest: string): Promise<OciImageValidationRecord | null>
	{
		const validation = await this._transaction.ociImageValidation.findFirst({ where: { id: validationId, siloId, submissionDigest }, select: _VALIDATION_SELECT });
		return validation ? _Record(validation) : null;
	}

	/** Save one pending admission answer or return the answer already stored by a replay. */
	async recordResult(siloId: string, validationId: string, submissionDigest: string, result: OciImageAdmissionResult): Promise<OciImageValidationWriteResult | null>
	{
		const data: Prisma.OciImageValidationUpdateManyMutationInput = result.accepted
			? { state: OciImageValidationStates.Imported, indexDigest: result.layout.indexDigest, imageManifestDigest: result.layout.imageManifestDigest, configDigest: result.layout.configDigest, registryReference: result.layout.registryReference, failureCode: null, completedAt: new Date() }
			: { state: OciImageValidationStates.Rejected, indexDigest: null, imageManifestDigest: null, configDigest: null, registryReference: null, failureCode: result.failureCode, completedAt: new Date() };
		const changed = await this._transaction.ociImageValidation.updateMany({ where: { id: validationId, siloId, submissionDigest, state: OciImageValidationStates.Pending }, data });
		const validation = await this._transaction.ociImageValidation.findFirst({ where: { id: validationId, siloId, submissionDigest }, select: _VALIDATION_SELECT });
		return validation ? { changed: changed.count === 1, validation: _Record(validation) } : null;
	}
}
