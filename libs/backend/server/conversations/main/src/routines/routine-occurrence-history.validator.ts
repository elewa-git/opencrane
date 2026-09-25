import { z } from "zod";

import { ConversationGenesisOriginKinds, ___ConversationGenesisOriginSchema, type RoutineOccurrenceConversationGenesisOrigin } from "@opencrane/models/conversations";

import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Rejects malformed stored instruction receipts without normalising their ownership evidence. */
const _Identifier = z.string().min(1).max(1024).refine(value => value.trim() === value);
/** Preserves a real ISO timestamp rather than inventing a new authentication or creation time. */
const _Instant = z.string().datetime({ offset: true });
/** Narrows the shared closed origin model to the routine arm without copying its fields. */
const _RoutineOrigin = ___ConversationGenesisOriginSchema.refine(function _RoutineOnly(value): value is RoutineOccurrenceConversationGenesisOrigin
{
	return value.kind === ConversationGenesisOriginKinds.RoutineOccurrence;
});
/** Keeps a validated digest's exact bytes while preserving its template-literal type. */
const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u).transform(function _TypedDigest(value): `sha256:${string}` { return `sha256:${value.slice(7)}`; });

/** Rejects invalid read coordinates before deriving a stream name or accessing history. */
export const _RoutineOccurrenceReadCoordinatesSchema = z.object({ siloId: _Identifier, conversationId: _Identifier }).strict();

/** Keeps saved evidence validation beside its model and forbids undeclared receipt fields. */
export const _RoutineOccurrenceHistoryRecordSchema: z.ZodType<RoutineOccurrenceHistoryRecord, z.ZodTypeDef, unknown> = z.object({
	siloId: _Identifier,
	conversationId: _Identifier,
	origin: _RoutineOrigin,
	agentServiceId: _Identifier,
	requesterPrincipalId: _Identifier,
	requesterIssuer: _Identifier,
	requesterSubjectId: _Identifier,
	requesterAuthenticatedAt: _Instant,
	task: z.object({ taskId: _Identifier, taskName: _Identifier, idempotencyKey: _Identifier }).strict(),
	audiencePrincipalIds: z.array(_Identifier).min(1).refine(values => new Set(values).size === values.length),
	computerId: _Identifier,
	agentIdentityId: _Identifier,
	profileRevisionId: _Identifier,
	createdAt: _Instant,
	payloadRef: _Identifier,
	ciphertextDigest: _Digest,
}).strict().refine(value => value.conversationId !== value.origin.destinationConversationId && value.audiencePrincipalIds.includes(value.requesterPrincipalId));
