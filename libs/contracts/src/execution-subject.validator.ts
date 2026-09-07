import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { z } from "zod";


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

/** Shared schema for an exact nonnegative Kurrent stream revision serialized in canonical decimal. */
const _KurrentRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);

/** Verifies that all duplicated evidence and scope coordinates bind to one trusted subject. */
function _ValidateSubjectBindings(subject: ExecutionSubject, context: z.RefinementCtx): void
{
	if (subject.requester.membership.principalId !== subject.requester.requesterPrincipalId || subject.requester.membership.siloId !== subject.siloId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["requester", "membership"], message: "requester membership must bind the authenticated requester and silo" });
	}
	if (subject.membership.kind === ExecutionSubjectMembershipKinds.Managed && (subject.membership.agentServiceId !== subject.runScope.agentServiceId || subject.membership.agentRevisionId !== subject.runScope.agentRevisionId))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["membership"], message: "managed membership must bind the admitted service and revision" });
	}
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

/** Validates signed human membership evidence; its signature and current status are checked by the authority. */
const _FleetMembershipSchema = z.object({ kind: z.literal(ExecutionSubjectMembershipKinds.Fleet), principalId: _PrincipalIdentifierSchema, siloId: _IdentifierSchema, revision: _PositiveIntegerSchema, assertionId: _IdentifierSchema, payloadDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, trustedUntil: _InstantSchema }).strict();

/** Validates a managed Principal binding; current service state and grants are checked by the authority. */
const _ManagedMembershipSchema = z.object({ kind: z.literal(ExecutionSubjectMembershipKinds.Managed), principalId: _PrincipalIdentifierSchema, siloId: _IdentifierSchema, agentServiceId: _IdentifierSchema, agentRevisionId: _IdentifierSchema, agentRevisionDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, trustedUntil: _InstantSchema }).strict();

/**
 * Validates execution-subject structure and matching coordinates, rejecting unknown fields.
 * Parsing does not verify signatures, expiry, or current authority. Admission and runtime
 * authorities must check current identity, membership, grants and lease state before using it.
 */
export const ___ExecutionSubjectSchema: z.ZodType<ExecutionSubject> = z.object({
	schemaVersion: z.literal(1),
	siloId: _IdentifierSchema,
	agentIdentityId: _IdentifierSchema,
	principalId: _PrincipalIdentifierSchema,
	identity: z.object({ agentIdentityId: _IdentifierSchema, principalId: _PrincipalIdentifierSchema, siloId: _IdentifierSchema, headRevision: _KurrentRevisionSchema, headDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, verifiedAt: _InstantSchema }).strict(),
	membership: z.discriminatedUnion("kind", [_FleetMembershipSchema, _ManagedMembershipSchema]),
	capability: z.object({ agentIdentityId: _IdentifierSchema, computerId: _IdentifierSchema, capabilitySetDigest: _DigestSchema, effectiveContractDigest: _DigestSchema, decisionEvidenceId: _IdentifierSchema, decidedAt: _InstantSchema }).strict(),
	runScope: z.object({ siloId: _IdentifierSchema, runId: _IdentifierSchema, attempt: _PositiveIntegerSchema, agentServiceId: _IdentifierSchema, agentRevisionId: _IdentifierSchema }).strict(),
	computerScope: z.object({ siloId: _IdentifierSchema, computerId: _IdentifierSchema, leaseId: _IdentifierSchema, leaseGeneration: _PositiveIntegerSchema }).strict(),
	requester: z.object({ siloId: _IdentifierSchema, requesterPrincipalId: _PrincipalIdentifierSchema, requestIdempotencyKey: _IdentifierSchema, authenticatedAt: _InstantSchema, membership: _FleetMembershipSchema }).strict(),
	admission: z.object({ authorizingPrincipalId: _PrincipalIdentifierSchema, decisionEvidenceId: _IdentifierSchema, admittedAt: _InstantSchema }).strict(),
}).strict().superRefine(_ValidateSubjectBindings) as z.ZodType<ExecutionSubject>;
