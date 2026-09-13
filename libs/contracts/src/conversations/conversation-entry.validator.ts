/**
 * Parses the structural contract for participant-visible conversation entries.
 *
 * The schemas reject unknown fields and incompatible author, provenance, and attestation shapes.
 * They do not verify a receipt or bind an entry to a computer; the receipt transformer and bound
 * writer perform those context-specific checks.
 */
import { z } from "zod";
import { MessageStates } from "@opencrane/models/conversations";
import { ConversationA2UIOperations, ConversationApprovalLogPhases, ConversationArtifactLogPhases, ConversationEntryAudiences, ConversationEntryProvenance, ConversationLogKinds, ConversationLogToolKinds, ConversationMemoryLogOperations, ConversationMemoryLogPhases, ConversationModelLogPhases, ConversationRunLogPhases, ConversationToolCallLogPhases } from "./conversation-entry-categories.types";

import { ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageActivations, ConversationMessageContentBlockKinds, type ConversationEntry } from "./conversation-entry.types";

const _IdentifierSchema = z.string().trim().min(1);
const _InstantSchema = z.string().datetime({ offset: true });
const _PositionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const _OpenCraneServiceId = "opencrane";
const _AuthorSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(ConversationAuthorKinds.Human), principalId: _IdentifierSchema, participantId: _IdentifierSchema, issuer: _IdentifierSchema, authenticatedAt: _InstantSchema, name: _IdentifierSchema, avatarArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ kind: z.literal(ConversationAuthorKinds.Agent), agentIdentityId: _IdentifierSchema, agentServiceId: _IdentifierSchema, name: _IdentifierSchema, avatarArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ kind: z.literal(ConversationAuthorKinds.Service), serviceId: _IdentifierSchema, name: _IdentifierSchema }).strict(),
	z.object({ kind: z.literal(ConversationAuthorKinds.System), systemId: z.literal("opencrane"), name: z.literal("OpenCrane") }).strict(),
]);
const _VisibilitySchema = z.discriminatedUnion("audience", [
	z.object({ audience: z.literal(ConversationEntryAudiences.Conversation) }).strict(),
	z.object({ audience: z.literal(ConversationEntryAudiences.ParticipantSubset), participantIds: z.array(_IdentifierSchema).min(1).refine(function _HasUniqueParticipantIds(participantIds): boolean { return new Set(participantIds).size === participantIds.length; }) }).strict(),
]);
const _AttestationSchema = z.object({ serviceId: _IdentifierSchema, receiptId: _IdentifierSchema, domainStream: _IdentifierSchema, domainRevision: _IdentifierSchema, decisionEvidenceId: _IdentifierSchema.nullable() }).strict();
const _EntryBase = {
	schemaVersion: z.literal(1),
	id: _IdentifierSchema,
	conversationId: _IdentifierSchema,
	position: _PositionSchema,
	author: _AuthorSchema,
	provenance: z.nativeEnum(ConversationEntryProvenance),
	visibility: _VisibilitySchema,
	runId: _IdentifierSchema.nullable(),
	causationId: _IdentifierSchema,
	correlationId: _IdentifierSchema,
	idempotencyKey: _IdentifierSchema,
	occurredAt: _InstantSchema,
	attestation: _AttestationSchema.nullable(),
};
const _MessageContentBlockSchema = z.discriminatedUnion("kind", [
	z.object({ id: _IdentifierSchema, kind: z.literal(ConversationMessageContentBlockKinds.Text), payloadRef: _IdentifierSchema, ciphertextDigest: _IdentifierSchema }).strict(),
	z.object({ id: _IdentifierSchema, kind: z.literal(ConversationMessageContentBlockKinds.Artifact), artifactId: _IdentifierSchema, artifactRevisionId: _IdentifierSchema, name: _IdentifierSchema, mediaType: _IdentifierSchema }).strict(),
	z.object({ id: _IdentifierSchema, kind: z.literal(ConversationMessageContentBlockKinds.Mention), targetKind: z.enum([ConversationAuthorKinds.Human, ConversationAuthorKinds.Agent]), targetId: _IdentifierSchema, name: _IdentifierSchema }).strict(),
]);
const _MessageEntrySchema = z.object({
	..._EntryBase,
	kind: z.literal(ConversationEntryKinds.Message),
	state: z.nativeEnum(MessageStates),
	blocks: z.array(_MessageContentBlockSchema).min(1).refine(function _HasUniqueBlockIds(blocks): boolean { return new Set(blocks.map(function _BlockId(block): string { return block.id; })).size === blocks.length; }),
	replyToEntryId: _IdentifierSchema.nullable(),
	addressedAgentIdentityId: _IdentifierSchema.nullable(),
	activation: z.nativeEnum(ConversationMessageActivations),
}).strict();
const _LogEntryBase = { ..._EntryBase, kind: z.literal(ConversationEntryKinds.Log), summary: _IdentifierSchema, detailsRef: _IdentifierSchema.nullable() };
const _LogEntrySchema = z.discriminatedUnion("logKind", [
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.Run), runId: _IdentifierSchema, phase: z.nativeEnum(ConversationRunLogPhases) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.Model), modelCallId: _IdentifierSchema, phase: z.nativeEnum(ConversationModelLogPhases) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.ToolCall), toolCallId: _IdentifierSchema, toolKind: z.nativeEnum(ConversationLogToolKinds), toolName: _IdentifierSchema, phase: z.nativeEnum(ConversationToolCallLogPhases), resultArtifactRevisionId: _IdentifierSchema.nullable() }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.Artifact), artifactId: _IdentifierSchema, artifactRevisionId: _IdentifierSchema.nullable(), phase: z.nativeEnum(ConversationArtifactLogPhases) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.Memory), operation: z.nativeEnum(ConversationMemoryLogOperations), phase: z.nativeEnum(ConversationMemoryLogPhases) }).strict(),
	z.object({ ..._LogEntryBase, logKind: z.literal(ConversationLogKinds.Approval), approvalId: _IdentifierSchema, action: _IdentifierSchema, phase: z.nativeEnum(ConversationApprovalLogPhases) }).strict(),
]);
const _A2UIEntrySchema = z.discriminatedUnion("operation", [
	z.object({ ..._EntryBase, kind: z.literal(ConversationEntryKinds.A2UI), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal(ConversationA2UIOperations.Replace), payloadRef: _IdentifierSchema, payloadDigest: _IdentifierSchema }).strict(),
	z.object({ ..._EntryBase, kind: z.literal(ConversationEntryKinds.A2UI), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal(ConversationA2UIOperations.Patch), payloadRef: _IdentifierSchema, payloadDigest: _IdentifierSchema }).strict(),
	z.object({ ..._EntryBase, kind: z.literal(ConversationEntryKinds.A2UI), surfaceId: _IdentifierSchema, a2uiSchemaVersion: _IdentifierSchema, operation: z.literal(ConversationA2UIOperations.Remove), payloadRef: z.null(), payloadDigest: z.null() }).strict(),
]);

const _ConversationEntrySchema = z.union([_MessageEntrySchema, _LogEntrySchema, _A2UIEntrySchema]);

function _ValidateProvenance(entry: ConversationEntry, context: z.RefinementCtx): void
{
	if (entry.provenance === ConversationEntryProvenance.HumanAuthored && entry.author.kind !== ConversationAuthorKinds.Human)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "human-authored entries require a human author" });
	}
	if (entry.provenance === ConversationEntryProvenance.AgentAuthored && entry.author.kind !== ConversationAuthorKinds.Agent)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "agent-authored entries require an agent author" });
	}
	if (entry.provenance === ConversationEntryProvenance.ServiceAttested && entry.attestation === null)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation"], message: "service-attested entries require a service attestation" });
	}
	if (entry.author.kind === ConversationAuthorKinds.Service && entry.attestation !== null && entry.attestation.serviceId !== entry.author.serviceId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation", "serviceId"], message: "a service author must match its attestation service" });
	}
	if (entry.author.kind === ConversationAuthorKinds.System && (entry.provenance !== ConversationEntryProvenance.ServiceAttested || entry.attestation === null || entry.attestation.serviceId !== _OpenCraneServiceId))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["attestation"], message: "a system author requires an OpenCrane service attestation" });
	}
}

function _ValidateComputerAuthoredEntry(entry: ConversationEntry, context: z.RefinementCtx): void
{
	if (entry.author.kind !== ConversationAuthorKinds.Agent)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["author"], message: "a computer entry requires its bound agent author" });
	}
	if (entry.provenance !== ConversationEntryProvenance.AgentAuthored)
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
