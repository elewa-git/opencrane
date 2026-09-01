import type { ExecutionSubject } from "@opencrane/models/agents";
import { z } from "zod";

import type { ExecutionSubjectVerificationContext } from "./execution-subject.validator.types";

/** Validates one bounded opaque identifier. */
function _IsIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Rejects the retired service-name sentinel where a durable Principal identifier is required. */
function _IsPrincipalIdentifier(value: unknown): value is string
{
	return _IsIdentifier(value) && !value.startsWith("agent-service:");
}

/** Shared schema for bounded opaque identifiers. */
const _IdentifierSchema = z.custom<string>(_IsIdentifier, { message: "must be a bounded identifier" });

/** Shared schema for a durable Principal identifier without the retired service-name sentinel. */
const _PrincipalIdentifierSchema = z.custom<string>(_IsPrincipalIdentifier, { message: "must be a durable Principal identifier, not an agent-service sentinel" });

/** Shared schema for a SHA-256 digest. */
const _DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/** Shared schema for canonical UTC instants. */
const _InstantSchema = z.string().datetime({ offset: true });

/** Shared schema for positive safe integer revisions and generations. */
const _PositiveIntegerSchema = z.number().int().positive().safe();

/** Shared schema for zero-based Kurrent stream revisions. */
const _NonNegativeIntegerSchema = z.number().int().nonnegative().safe();

/** Shared schema for an exact nonnegative Kurrent stream revision serialized in canonical decimal. */
const _KurrentRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);

/** Verifies that all duplicated evidence and scope coordinates bind to one trusted subject. */
function _ValidateSubjectBindings(subject: ExecutionSubject, context: z.RefinementCtx): void
{
	if (subject.identity.agentIdentityId !== subject.agentIdentityId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["identity", "agentIdentityId"], message: "identity evidence must bind the execution subject identity" });
	}
	if (subject.identity.principalId !== subject.principalId || subject.membership.principalId !== subject.principalId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["principalId"], message: "identity and membership evidence must bind the execution subject principal" });
	}
	if (subject.identity.siloId !== subject.siloId || subject.membership.siloId !== subject.siloId || subject.runScope.siloId !== subject.siloId || subject.computerScope.siloId !== subject.siloId || subject.requester.siloId !== subject.siloId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["siloId"], message: "every execution-subject evidence and scope coordinate must share the subject silo" });
	}
	if (subject.capability.agentIdentityId !== subject.agentIdentityId || subject.capability.computerId !== subject.computerScope.computerId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["capability"], message: "capability evidence must bind the execution subject identity and computer" });
	}
}

/** Verifies that one structurally valid subject still matches the current authority snapshot. */
function _ValidateCurrentAuthority(subject: ExecutionSubject, current: ExecutionSubjectVerificationContext): boolean
{
	return subject.siloId === current.siloId
		&& subject.agentIdentityId === current.agentIdentityId
		&& subject.principalId === current.principalId
		&& subject.identity.headRevision === current.identityHeadRevision
		&& subject.identity.headDigest === current.identityHeadDigest
		&& subject.identity.decisionEvidenceId === current.identityDecisionEvidenceId
		&& subject.identity.verifiedAt === current.identityVerifiedAt
		&& subject.membership.revision === current.membershipRevision
		&& subject.membership.assertionId === current.membershipAssertionId
		&& subject.membership.payloadDigest === current.membershipPayloadDigest
		&& subject.membership.decisionEvidenceId === current.membershipDecisionEvidenceId
		&& subject.membership.trustedUntil === current.membershipTrustedUntil
		&& subject.capability.capabilitySetDigest === current.capabilitySetDigest
		&& subject.capability.effectiveContractDigest === current.effectiveContractDigest
		&& subject.capability.decisionEvidenceId === current.capabilityDecisionEvidenceId
		&& subject.capability.decidedAt === current.capabilityDecidedAt
		&& subject.runScope.runId === current.runId
		&& subject.runScope.attempt === current.attempt
		&& subject.runScope.agentServiceId === current.agentServiceId
		&& subject.runScope.agentRevisionId === current.agentRevisionId
		&& subject.computerScope.computerId === current.computerId
		&& subject.computerScope.leaseId === current.computerLeaseId
		&& subject.computerScope.leaseGeneration === current.computerLeaseGeneration
		&& subject.requester.requesterPrincipalId === current.requesterPrincipalId
		&& subject.requester.requestIdempotencyKey === current.requestIdempotencyKey
		&& subject.requester.authenticatedAt === current.requesterAuthenticatedAt
		&& subject.admission.authorizingPrincipalId === current.authorizingPrincipalId
		&& subject.admission.decisionEvidenceId === current.admissionDecisionEvidenceId
		&& subject.admission.admittedAt === current.admissionAdmittedAt
		&& Date.parse(subject.membership.trustedUntil) > current.nowEpochMilliseconds;
}

/** Strict wire schema for one evidence-bound execution subject. */
export const ___ExecutionSubjectSchema: z.ZodType<ExecutionSubject> = z.object({
	schemaVersion: z.literal(1),
	siloId: _IdentifierSchema,
	agentIdentityId: _IdentifierSchema,
	principalId: _PrincipalIdentifierSchema,
	identity: z.object({ agentIdentityId: _IdentifierSchema, principalId: _PrincipalIdentifierSchema, siloId: _IdentifierSchema, headRevision: _KurrentRevisionSchema, headDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, verifiedAt: _InstantSchema }).strict(),
	membership: z.object({ principalId: _PrincipalIdentifierSchema, siloId: _IdentifierSchema, revision: _PositiveIntegerSchema, assertionId: _IdentifierSchema, payloadDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, trustedUntil: _InstantSchema }).strict(),
	capability: z.object({ agentIdentityId: _IdentifierSchema, computerId: _IdentifierSchema, capabilitySetDigest: _DigestSchema, effectiveContractDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, decidedAt: _InstantSchema }).strict(),
	runScope: z.object({ siloId: _IdentifierSchema, runId: _IdentifierSchema, attempt: _PositiveIntegerSchema, agentServiceId: _IdentifierSchema, agentRevisionId: _IdentifierSchema }).strict(),
	computerScope: z.object({ siloId: _IdentifierSchema, computerId: _IdentifierSchema, leaseId: _IdentifierSchema, leaseGeneration: _PositiveIntegerSchema }).strict(),
	requester: z.object({ siloId: _IdentifierSchema, requesterPrincipalId: _PrincipalIdentifierSchema, requestIdempotencyKey: _IdentifierSchema, authenticatedAt: _InstantSchema }).strict(),
	admission: z.object({ authorizingPrincipalId: _PrincipalIdentifierSchema, decisionEvidenceId: _IdentifierSchema, admittedAt: _InstantSchema }).strict(),
}).strict().superRefine(_ValidateSubjectBindings) as z.ZodType<ExecutionSubject>;

/**
 * Parses an execution subject only when it still binds the current authority snapshot.
 *
 * Runtime dispatch calls this for both the assignment and frozen snapshot before it sends work to a
 * computer. The caller obtains `current` from the same trusted authority read that admits or
 * resumes work; this parser never turns requester provenance into authorization on its own.
 *
 * Called by: `_ExecutionSubjectFromRows` in `prisma-runtime-dispatch-repository.ts`.
 */
export function ___ParseExecutionSubject(value: unknown, current: ExecutionSubjectVerificationContext): ExecutionSubject | null
{
	const parsed = ___ExecutionSubjectSchema.safeParse(value);
	if (!parsed.success)
		return null;
	return _ValidateCurrentAuthority(parsed.data, current) ? parsed.data : null;
}
