import { z } from "zod";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerStopAdmission, ConversationComputerStopPublishOutcome, ConversationComputerStopSelection } from "./conversation-computer-stop.types";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions } from "./conversation-computer-stop.types";

const _Identifier = z.string().min(1);
const _Uuid = z.string().uuid();
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Position = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const _Positive = z.number().int().positive().safe();
const _Task = z.object({ taskId: _Identifier, taskName: _Identifier, idempotencyKey: _Identifier }).strict();
const _Command = z.object({ commandId: _Uuid, siloId: _Identifier, conversationId: _Identifier, computerId: _Identifier, generation: _Positive, causationId: _Uuid, causationPosition: _Position, requester: z.object({ principalId: _Identifier, subjectId: _Identifier, issuer: _Identifier, authenticatedAt: z.string().datetime({ offset: true }) }).strict() }).strict();
const _Common = { command: _Command, commandDigest: _Digest, authorizationDecisionDigest: _Digest } as const;
const _Target = z.object({ bootstrapId: _Uuid, runId: _Identifier, attempt: _Positive, leaseId: _Identifier, leaseGeneration: _Positive }).strict();

/** Rejects malformed command selections before replay trusts their fixed target. */
export const _ConversationComputerStopSelectionSchema: z.ZodType<ConversationComputerStopSelection> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(ConversationComputerStopAdmissionKinds.NoTarget), ..._Common, activeTurnStreamName: _Identifier, activeTurnExpectedRevision: _Position.nullable() }).strict(),
	z.object({ kind: z.literal(ConversationComputerStopAdmissionKinds.Target), ..._Common, target: _Target, originalTurnTask: _Task, activeTurnStreamName: _Identifier, activeTurnExpectedRevision: _Position }).strict(),
]);

/** Rejects malformed durable Stop admissions before replay trusts their audit coordinates. */
export const _ConversationComputerStopAdmissionSchema: z.ZodType<ConversationComputerStopAdmission> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(ConversationComputerStopAdmissionKinds.NoTarget), ..._Common, activeTurnStreamName: _Identifier, activeTurnExpectedRevision: _Position.nullable() }).strict(),
	z.object({ kind: z.literal(ConversationComputerStopAdmissionKinds.Target), ..._Common, target: _Target, originalTurnTask: _Task, cancellationTask: _Task, requestedAt: z.string().datetime({ offset: true }) }).strict(),
]);

/** Rejects malformed durable Stop outcomes before replay treats them as terminal. */
export const _ConversationComputerStopPublishOutcomeSchema: z.ZodType<ConversationComputerStopPublishOutcome> = z.object({ decision: z.nativeEnum(ConversationComputerStopDecisions), published: z.boolean(), outputReceiptDigest: _Digest.nullable() }).strict();

/** Validates the admission and terminal outcome as one durable Stop receipt. */
export const _ConversationComputerStopReceiptSchema = z.object({ admission: _ConversationComputerStopAdmissionSchema, outcome: _ConversationComputerStopPublishOutcomeSchema }).strict().superRefine(function _DecisionMatchesAdmission(receipt, context)
{
	const digestInput = receipt.admission.kind === ConversationComputerStopAdmissionKinds.NoTarget
		? { command: receipt.admission.command, activeTurnStreamName: receipt.admission.activeTurnStreamName, activeTurnExpectedRevision: receipt.admission.activeTurnExpectedRevision }
		: { command: receipt.admission.command, target: receipt.admission.target, originalTurnTask: receipt.admission.originalTurnTask };
	if (receipt.admission.commandDigest !== ___DigestCanonicalJson(digestInput as unknown as JsonValue))
		context.addIssue({ code: "custom", message: "Stop receipt command digest differs from its admission" });
	const noTarget = receipt.admission.kind === ConversationComputerStopAdmissionKinds.NoTarget && receipt.outcome.decision === ConversationComputerStopDecisions.NoTarget && receipt.outcome.outputReceiptDigest === null;
	const cancellation = receipt.admission.kind === ConversationComputerStopAdmissionKinds.Target && receipt.outcome.decision === ConversationComputerStopDecisions.CancellationWon && receipt.outcome.outputReceiptDigest === null;
	const output = receipt.admission.kind === ConversationComputerStopAdmissionKinds.Target && receipt.outcome.decision === ConversationComputerStopDecisions.OutputWon && receipt.outcome.outputReceiptDigest !== null;
	if (!receipt.outcome.published || !noTarget && !cancellation && !output)
		context.addIssue({ code: "custom", message: "Stop receipt outcome differs from its admission" });
});
