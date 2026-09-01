/**
 * Parses the structural contract for participant-visible conversation entries.
 *
 * The schemas reject unknown fields and incompatible author, provenance, and attestation shapes.
 * They do not verify a receipt or bind an entry to a computer; the receipt transformer and bound
 * writer perform those context-specific checks.
 */
import { z } from "zod";

import { ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds, type ConversationEntry } from "./conversation-entry.types";

const _IdentifierSchema = z.string().trim().min(1);
const _InstantSchema = z.string().datetime({ offset: true });
const _PositionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const _OpaquePayloadReferenceSchema = z.string().regex(/^payload:\/\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
const _PayloadDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const _HumanAuthoredProvenance = "human-authored";
const _AgentAuthoredProvenance = "agent-authored";
const _ServiceAttestedProvenance = "service-attested";
const _HumanAuthorKind = "human";
const _AgentAuthorKind = "agent";
const _ServiceAuthorKind = "service";
const _SystemAuthorKind = "system";
const _OpenCraneServiceId = "opencrane";
const _AuthorSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("human"), principalId: _IdentifierSchema, participantId: _IdentifierSchema, name: _IdentifierSchema, avatarArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ kind: z.literal("agent"), agentIdentityId: _IdentifierSchema, agentServiceId: _IdentifierSchema, name: _IdentifierSchema, avatarArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ kind: z.literal("service"), serviceId: _IdentifierSchema, name: _IdentifierSchema }).strict(),
	z.object({ kind: z.literal("system"), systemId: z.literal("opencrane"), name: z.literal("OpenCrane") }).strict(),
]);
const _VisibilitySchema = z.discriminatedUnion("audience", [
	z.object({ audience: z.literal("conversation") }).strict(),
	z.object({ audience: z.literal("participant_subset"), participantIds: z.array(_IdentifierSchema).min(1).refine(function _HasUniqueParticipantIds(participantIds): boolean { return new Set(participantIds).size === participantIds.length; }) }).strict(),
]);
const _AttestationSchema = z.object({ serviceId: _IdentifierSchema, receiptId: _IdentifierSchema, domainStream: _IdentifierSchema, domainRevision: _IdentifierSchema, decisionEvidenceId: _IdentifierSchema.nullable() }).strict();
const _EntryBase = {
	schemaVersion: z.literal(1),
	id: _IdentifierSchema,
	conversationId: _IdentifierSchema,
	position: _PositionSchema,
	author: _AuthorSchema,
	provenance: z.enum(["human-authored", "agent-authored", "service-attested"]),
	visibility: _VisibilitySchema,
	runId: _IdentifierSchema.nullable(),
	causationId: _IdentifierSchema,
	correlationId: _IdentifierSchema,
	idempotencyKey: _IdentifierSchema,
	occurredAt: _InstantSchema,
	attestation: _AttestationSchema.nullable(),
};
const _MessageContentBlockSchema = z.discriminatedUnion("kind", [
	z.object({ id: _IdentifierSchema, kind: z.literal("text"), payloadRef: _IdentifierSchema, ciphertextDigest: _IdentifierSchema }).strict(),
	z.object({ id: _IdentifierSchema, kind: z.literal("artifact"), artifactId: _IdentifierSchema, artifactRevisionId: _IdentifierSchema, name: _IdentifierSchema, mediaType: _IdentifierSchema }).strict(),
	z.object({ id: _IdentifierSchema, kind: z.literal("mention"), targetKind: z.enum(["human", "agent"]), targetId: _IdentifierSchema, name: _IdentifierSchema }).strict(),
]);
const _MessageEntrySchema = z.object({
	..._EntryBase,
	kind: z.literal("message"),
	state: z.enum(["pending", "streaming", "completed", "failed", "cancelled"]),
	blocks: z.array(_MessageContentBlockSchema).min(1).refine(function _HasUniqueBlockIds(blocks): boolean { return new Set(blocks.map(function _BlockId(block): string { return block.id; })).size === blocks.length; }),
	replyToEntryId: _IdentifierSchema.nullable(),
	addressedAgentIdentityId: _IdentifierSchema.nullable(),
	activation: z.enum(["none", "start", "interrupt"]),
}).strict();
const _LogEntryBase = { ..._EntryBase, kind: z.literal("log"), summary: _IdentifierSchema, detailsRef: _IdentifierSchema.nullable() };
const _LogEntrySchema = z.discriminatedUnion("logKind", [
	z.object({ ..._LogEntryBase, logKind: z.literal("run"), runId: _IdentifierSchema, phase: z.enum(["queued", "started", "interrupted", "completed", "failed", "recovery_required"]) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal("model"), modelCallId: _IdentifierSchema, phase: z.enum(["started", "streaming", "completed", "failed", "cancelled"]) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal("tool_call"), toolCallId: _IdentifierSchema, toolKind: z.enum(["local", "mcp", "oci"]), toolName: _IdentifierSchema, phase: z.enum(["requested", "running", "completed", "failed", "cancelled", "recovery_required"]), resultArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal("artifact"), artifactId: _IdentifierSchema, artifactRevisionId: _IdentifierSchema.nullable(), phase: z.enum(["uploading", "scanning", "published", "rejected", "failed"]) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal("memory"), operation: z.enum(["recall", "write"]), phase: z.enum(["requested", "completed", "failed", "denied"]) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal("approval"), approvalId: _IdentifierSchema, action: _IdentifierSchema, phase: z.enum(["requested", "granted", "denied", "expired", "revoked"]) }).strict(),
]);
const { runId: _RetiredRunId, ..._ConversationComputerEntryBase } = _EntryBase;
const _ElicitationEntryBase = {
	..._ConversationComputerEntryBase,
	kind: z.literal(ConversationEntryKinds.Elicitation),
	elicitationId: _IdentifierSchema,
	computerId: _IdentifierSchema,
	computerExecutionId: _IdentifierSchema,
	leaseGeneration: z.number().int().positive(),
	elicitationKind: z.enum([
		ConversationElicitationEntryKinds.RuntimeInput,
		ConversationElicitationEntryKinds.ToolApproval,
		ConversationElicitationEntryKinds.PersonalMemoryPermission,
		ConversationElicitationEntryKinds.A2uiAction,
	]),
};
const _ElicitationRequestEntrySchema = z.object({
	..._ElicitationEntryBase,
	state: z.literal(ConversationElicitationEntryStates.Requested),
	profileRevisionId: _IdentifierSchema,
	addressedParticipantId: _IdentifierSchema,
	requestPayloadRef: _OpaquePayloadReferenceSchema,
	requestPayloadDigest: _PayloadDigestSchema,
	expiresAt: _InstantSchema,
}).strict();
const _ElicitationResolutionEntrySchema = z.object({
	..._ElicitationEntryBase,
	state: z.enum([ConversationElicitationEntryStates.Answered, ConversationElicitationEntryStates.Declined, ConversationElicitationEntryStates.Expired, ConversationElicitationEntryStates.Cancelled]),
	requestEntryId: _IdentifierSchema,
	responsePayloadRef: _OpaquePayloadReferenceSchema.nullable(),
	responsePayloadDigest: _PayloadDigestSchema.nullable(),
}).strict().superRefine(function _ValidateElicitationResolutionPayload(entry, context): void
{
	const hasResponseCoordinates = entry.responsePayloadRef !== null && entry.responsePayloadDigest !== null;
	const hasNoResponseCoordinates = entry.responsePayloadRef === null && entry.responsePayloadDigest === null;
	if (entry.state === ConversationElicitationEntryStates.Answered && !hasResponseCoordinates)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["responsePayloadRef"], message: "answered elicitations require both response payload coordinates" });
	}
	if (entry.state !== ConversationElicitationEntryStates.Answered && !hasNoResponseCoordinates)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["responsePayloadRef"], message: "terminal non-answer outcomes require neither response payload coordinate" });
	}
});
const _ElicitationEntrySchema = z.union([_ElicitationRequestEntrySchema, _ElicitationResolutionEntrySchema]);
const _A2UIEntrySchema = z.discriminatedUnion("operation", [
	z.object({ ..._EntryBase, kind: z.literal("a2ui"), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal("replace"), payloadRef: _IdentifierSchema, payloadDigest: _IdentifierSchema }).strict(),
	z.object({ ..._EntryBase, kind: z.literal("a2ui"), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal("patch"), payloadRef: _IdentifierSchema, payloadDigest: _IdentifierSchema }).strict(),
	z.object({ ..._EntryBase, kind: z.literal("a2ui"), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal("remove"), payloadRef: z.null(), payloadDigest: z.null() }).strict(),
]);

const _ConversationEntrySchema = z.union([_MessageEntrySchema, _LogEntrySchema, _ElicitationEntrySchema, _A2UIEntrySchema]);

function _ValidateProvenance(entry: ConversationEntry, context: z.RefinementCtx): void
{
	if (entry.provenance === _HumanAuthoredProvenance && entry.author.kind !== _HumanAuthorKind)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "human-authored entries require a human author" });
	}
	if (entry.provenance === _AgentAuthoredProvenance && entry.author.kind !== _AgentAuthorKind)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "agent-authored entries require an agent author" });
	}
	if (entry.provenance === _ServiceAttestedProvenance && entry.attestation === null)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation"], message: "service-attested entries require a service attestation" });
	}
	if (entry.author.kind === _ServiceAuthorKind && entry.attestation !== null && entry.attestation.serviceId !== entry.author.serviceId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation", "serviceId"], message: "a service author must match its attestation service" });
	}
	if (entry.author.kind === _SystemAuthorKind && (entry.provenance !== _ServiceAttestedProvenance || entry.attestation === null || entry.attestation.serviceId !== _OpenCraneServiceId))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation"], message: "a system author requires an OpenCrane service attestation" });
	}
	if (entry.kind === ConversationEntryKinds.Elicitation && (entry.author.kind !== _SystemAuthorKind || entry.provenance !== _ServiceAttestedProvenance || entry.attestation === null || entry.attestation.serviceId !== _OpenCraneServiceId))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "elicitation entries require an OpenCrane system attestation" });
	}
}

function _ValidateComputerAuthoredEntry(entry: ConversationEntry, context: z.RefinementCtx): void
{
	if (entry.author.kind !== _AgentAuthorKind)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "a computer entry requires its bound agent author" });
	}
	if (entry.provenance !== _AgentAuthoredProvenance)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["provenance"], message: "a computer entry must be agent-authored" });
	}
	if (entry.attestation !== null)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation"], message: "a computer entry cannot claim a service attestation" });
	}
}

/**
 * Validates the complete participant-visible event union before it reaches a writer or projector.
 *
 * The parser accepts opaque payload references and service-attestation coordinates rather than
 * plaintext bodies or storage capabilities. Writers separately stamp trusted identity, computer,
 * lease, and stream coordinates before append.
 */
export const ___ConversationEntrySchema: z.ZodType<ConversationEntry> = _ConversationEntrySchema.superRefine(_ValidateProvenance);

/**
 * Validates an entry that a conversation computer may submit to its bound writer.
 *
 * A computer may submit only an agent-authored message, local log, or A2UI fact. Its bound writer
 * separately verifies that the entry belongs to that computer and stream. A receipt transformer
 * verifies the service receipt before it creates a service-attested entry.
 */
export const ___ConversationComputerEntrySchema: z.ZodType<ConversationEntry> = _ConversationEntrySchema.superRefine(_ValidateComputerAuthoredEntry);
