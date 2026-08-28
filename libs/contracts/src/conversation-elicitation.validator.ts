import { z } from "zod";

import { AGENT_RUNTIME_PROTOCOL_VERSION, RuntimeCandidateKinds, type RuntimeElicitationCandidate } from "./agent-runtime-protocol.types";
import { ElicitationBodyKinds, ElicitationPurposes } from "./conversation-elicitation.types";

/**
 * Runtime elicitation validation lives beside the shared model so transports cannot accept a
 * different proposal shape from the durable elicitation authority.
 */

/** Bounded non-empty text used in participant-facing runtime proposals. */
const _ParticipantText = z.string().trim().min(1).max(2_000);
/** Bounded opaque identifier that cannot carry control characters. */
const _Identifier = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);
/** Canonical SHA-256 digest carried on protected purpose payloads. */
const _Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
/** One server-renderable choice from untrusted model output. */
const _Choice = z.object({ value: _Identifier, label: z.string().trim().min(1).max(500), description: z.string().trim().min(1).max(1_000).optional() }).strict();
/** Approval-shaped input with bounded disclosure fields. */
const _ApprovalBody = z.object({ kind: z.literal(ElicitationBodyKinds.Approval), prompt: _ParticipantText, action: z.string().trim().min(1).max(1_000), target: z.string().trim().min(1).max(1_000), dataUse: _ParticipantText, externalSystem: z.string().trim().min(1).max(500).optional(), consequence: _ParticipantText, cost: z.string().trim().min(1).max(500).optional() }).strict();
/** Single-choice input with distinct bounded values. */
const _SingleChoiceBody = z.object({ kind: z.literal(ElicitationBodyKinds.SingleChoice), prompt: _ParticipantText, choices: z.array(_Choice).min(1).max(50) }).strict().superRefine(function _DistinctChoices(body, context)
{
	if (new Set(body.choices.map(function _Value(choice) { return choice.value; })).size !== body.choices.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "choice values must be distinct" });
});
/** Multiple-choice input with coherent selection bounds and distinct values. */
const _MultipleChoiceBody = z.object({ kind: z.literal(ElicitationBodyKinds.MultipleChoice), prompt: _ParticipantText, choices: z.array(_Choice).min(1).max(50), minimumSelections: z.number().int().min(0).max(50), maximumSelections: z.number().int().min(1).max(50) }).strict().superRefine(function _ValidSelectionRange(body, context)
{
	if (new Set(body.choices.map(function _Value(choice) { return choice.value; })).size !== body.choices.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "choice values must be distinct" });
	if (body.minimumSelections > body.maximumSelections || body.maximumSelections > body.choices.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumSelections"], message: "selection bounds must fit the choices" });
});
/** Free-text input whose eventual answer is capped by the same server limit. */
const _FreeTextBody = z.object({ kind: z.literal(ElicitationBodyKinds.FreeText), prompt: _ParticipantText, maximumLength: z.number().int().min(1).max(20_000), allowEmpty: z.boolean() }).strict();
/** Complete participant-facing body accepted from a runtime proposal. */
const _Body = z.union([_ApprovalBody, _SingleChoiceBody, _MultipleChoiceBody, _FreeTextBody]);
/** Generic runtime-input proposal, which cannot carry a hidden purpose payload. */
const _RuntimeInputProposal = z.object({ requestKey: _Identifier, purpose: z.literal(ElicitationPurposes.RuntimeInput), body: _Body, purposePayloadDigest: _Digest, expiresInSeconds: z.number().int().min(30).max(900) }).strict();
/** Reviewed A2UI action coordinates; arbitrary hidden fields are refused. */
const _A2uiPurposePayload = z.object({ displayedActionId: _Identifier, sourceComponentId: _Identifier, actionDigest: _Digest }).strict();
/** A2UI action proposal whose protected display coordinates must remain bound by their digest. */
const _A2uiActionProposal = z.object({ requestKey: _Identifier, purpose: z.literal(ElicitationPurposes.A2uiAction), body: _Body, purposePayloadDigest: _Digest, purposePayload: _A2uiPurposePayload, expiresInSeconds: z.number().int().min(30).max(900) }).strict();
/** Runtime candidate coordinates plus the two generic purposes a runtime may propose. */
const _RuntimeElicitationCandidateSchema = z.object({
	protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
	runtimeInstanceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/u),
	commandId: _Identifier,
	candidateId: _Identifier,
	runId: _Identifier,
	attempt: z.number().int().positive(),
	fence: z.number().int().positive(),
	kind: z.literal(RuntimeCandidateKinds.Elicitation),
	proposal: z.union([_RuntimeInputProposal, _A2uiActionProposal]),
}).strict();

/**
 * Parse one untrusted runtime elicitation candidate without repairing or widening it.
 *
 * Called by: the agent-runtime HTTP transport before durable candidate admission.
 * @param value - Parsed JSON body supplied by an authenticated runtime Pod.
 * @returns The bounded candidate, or null when any coordinate, body, purpose, or hidden payload is invalid.
 */
export function ___ParseRuntimeElicitationCandidate(value: unknown): RuntimeElicitationCandidate | null
{
	const parsed = _RuntimeElicitationCandidateSchema.safeParse(value);
	return parsed.success ? parsed.data as RuntimeElicitationCandidate : null;
}
