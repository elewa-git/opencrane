import { z } from "zod";

import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatContentRevision, PersonaFirstChatCurrentQuestion, PersonaFirstChatPersona, PersonaFirstChatSnapshot, PersonaFirstChatTranscriptEntry, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteSnapshot, UserOnboardingRouteStates } from "./persona-first-chat.types.js";

/**
 * First-chat runtime validation stays beside the frontend model so generated transport data cannot
 * acquire a second, looser lifecycle interpretation in feature code.
 */

/** Exact question count required by every reviewed bootstrap source. */
const _QUESTION_COUNT = 3;

/** Bounded approved persona evidence selected by the server. */
const _PersonaSchema: z.ZodType<PersonaFirstChatPersona> = z.object({
	revisionId: z.string().min(1).max(256),
	displayName: z.string().min(1).max(512),
	archetype: z.nativeEnum(PersonaFirstChatArchetypes),
	primaryColour: z.nativeEnum(PersonaFirstChatColours)
}).strip();

/** Immutable reviewed source identity without exposing its instruction body. */
const _ContentRevisionSchema: z.ZodType<PersonaFirstChatContentRevision> = z.object({
	id: z.string().min(1).max(256),
	digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
	sourceLabel: z.string().min(1).max(512)
}).strip();

/** One canonical bounded transcript entry. */
const _TranscriptEntrySchema: z.ZodType<PersonaFirstChatTranscriptEntry> = z.object({
	ordinal: z.number().int().positive(),
	role: z.nativeEnum(PersonaFirstChatTranscriptRoles),
	kind: z.nativeEnum(PersonaFirstChatTranscriptKinds),
	text: z.string().min(1).max(20_000),
	questionOrdinal: z.number().int().min(1).max(_QUESTION_COUNT).nullable()
}).strip();

/** One exact next question selected by the durable answer count. */
const _CurrentQuestionSchema: z.ZodType<PersonaFirstChatCurrentQuestion> = z.object({
	ordinal: z.number().int().min(1).max(_QUESTION_COUNT),
	text: z.string().min(1).max(4_000)
}).strip();

/** State-keyed validators for the complete first-chat projection evidence matrix. */
const _STATE_EVIDENCE_VALIDATORS: Readonly<Record<UserOnboardingRouteStates, (snapshot: PersonaFirstChatSnapshot) => boolean>> =
{
	[UserOnboardingRouteStates.SurveyPending]: function _SurveyPending(snapshot) { return _EmptyEvidence(snapshot); },
	[UserOnboardingRouteStates.SurveyInProgress]: function _SurveyInProgress(snapshot) { return _EmptyEvidence(snapshot); },
	[UserOnboardingRouteStates.BootstrapChatPending]: function _BootstrapPending(snapshot) { return _PendingEvidence(snapshot); },
	[UserOnboardingRouteStates.BootstrapChatInProgress]: function _BootstrapInProgress(snapshot) { return _InProgressEvidence(snapshot); },
	[UserOnboardingRouteStates.Completed]: function _Completed(snapshot) { return _CompletedEvidence(snapshot); }
};

/** Complete first-chat response with cross-field authority and resumability checks. */
const _SnapshotSchema: z.ZodType<PersonaFirstChatSnapshot> = z.object({
	workflowVersion: z.number().int().positive(),
	state: z.nativeEnum(UserOnboardingRouteStates),
	conversationId: z.string().min(1).max(256).nullable(),
	persona: _PersonaSchema.nullable(),
	contentRevision: _ContentRevisionSchema.nullable(),
	transcript: z.array(_TranscriptEntrySchema).max(16),
	currentQuestion: _CurrentQuestionSchema.nullable(),
	answerCount: z.number().int().min(0).max(_QUESTION_COUNT),
	questionCount: z.number().int().min(0).max(_QUESTION_COUNT),
	canConclude: z.boolean(),
	startedAt: z.string().datetime({ offset: true }).nullable(),
	completedAt: z.string().datetime({ offset: true }).nullable()
}).strip().superRefine(function _ValidateSnapshot(snapshot, context)
{
	// 1. Preserve the server's contiguous transcript order so reconnects cannot reorder evidence.
	const transcriptOrdered = snapshot.transcript.every(function _InOrder(entry, index) { return entry.ordinal === index + 1; });
	if (!transcriptOrdered) context.addIssue({ code: z.ZodIssueCode.custom, path: ["transcript"], message: "must have contiguous one-based ordering" });

	// 2. Keep pre-chat workflow projections empty rather than inventing local conversation state.
	const hasConversation = snapshot.conversationId !== null;
	if (!hasConversation && (snapshot.startedAt !== null || snapshot.transcript.length > 0 || snapshot.answerCount > 0 || snapshot.currentQuestion !== null || snapshot.canConclude))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversationId"], message: "is required for first-chat evidence" });
	}
	if ((snapshot.persona === null) !== (snapshot.contentRevision === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["persona"], message: "must be paired with the reviewed source" });
	if (!hasConversation && snapshot.persona !== null && snapshot.questionCount !== _QUESTION_COUNT) context.addIssue({ code: z.ZodIssueCode.custom, path: ["questionCount"], message: "must match the reviewed pending source" });

	// 3. Once started, require every immutable source coordinate and the exact reviewed question count.
	if (hasConversation && (snapshot.conversationId === null || snapshot.persona === null || snapshot.contentRevision === null || snapshot.startedAt === null || snapshot.questionCount !== _QUESTION_COUNT))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversationId"], message: "must carry complete pinned first-chat provenance" });
	}

	// 4. The next question and conclusion eligibility must follow only the server-confirmed answer count.
	if (snapshot.currentQuestion !== null && snapshot.currentQuestion.ordinal !== snapshot.answerCount + 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["currentQuestion", "ordinal"], message: "must follow the admitted answer count" });
	if (snapshot.canConclude && (snapshot.answerCount !== _QUESTION_COUNT || snapshot.questionCount !== _QUESTION_COUNT)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["canConclude"], message: "requires all reviewed answers" });
	if (snapshot.state === UserOnboardingRouteStates.Completed && snapshot.completedAt === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "is required for completed onboarding" });

	// 5. Reject every cross-field combination the authority cannot emit so the UI never renders a blank success state.
	if (!_STATE_EVIDENCE_VALIDATORS[snapshot.state](snapshot)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "does not match its first-chat evidence" });

	// 6. Preserve the exact opening/question/answer role and coordinate sequence emitted by the authority.
	if (!_TranscriptMatchesEvidence(snapshot)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["transcript"], message: "does not match admitted answer evidence" });
});

/** Public route-state response used for authority-derived navigation. */
const _RouteSnapshotSchema: z.ZodType<UserOnboardingRouteSnapshot> = z.object({
	workflowVersion: z.number().int().positive(),
	state: z.nativeEnum(UserOnboardingRouteStates),
	personaInterviewId: z.string().min(1).max(256).nullable(),
	personaRevisionId: z.string().min(1).max(256).nullable(),
	bootstrapConversationId: z.string().min(1).max(256).nullable(),
	startedAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	completedAt: z.string().datetime({ offset: true }).nullable()
}).strip();

/** Parse one untrusted first-chat response or fail closed before feature state consumes it. */
export function _ParsePersonaFirstChatSnapshot(value: unknown): PersonaFirstChatSnapshot
{
	const parsed = _SnapshotSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The onboarding authority returned an invalid first-chat projection.");
}

/** Recover only a documented answer-conflict projection; every other error remains opaque. */
export function _ParsePersonaFirstChatConflictSnapshot(value: unknown): PersonaFirstChatSnapshot | null
{
	const parsed = z.object({
		error: z.enum(["onboarding_chat_idempotency_conflict", "onboarding_chat_state_conflict"]),
		chat: _SnapshotSchema
	}).strip().safeParse(value);
	return parsed.success ? parsed.data.chat : null;
}

/** Parse one untrusted route-state response used for post-approval navigation. */
export function _ParseUserOnboardingRouteSnapshot(value: unknown): UserOnboardingRouteSnapshot
{
	const parsed = _RouteSnapshotSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The onboarding authority returned an invalid route-state projection.");
}

/** Whether a pre-chat route carries no conversation, persona, source, or completion evidence. */
function _EmptyEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return snapshot.conversationId === null && snapshot.persona === null && snapshot.contentRevision === null && snapshot.transcript.length === 0 && snapshot.currentQuestion === null && snapshot.answerCount === 0 && snapshot.questionCount === 0 && !snapshot.canConclude && snapshot.startedAt === null && snapshot.completedAt === null;
}

/** Whether a pending chat names its reviewed persona and source without inventing conversation evidence. */
function _PendingEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return snapshot.conversationId === null && snapshot.persona !== null && snapshot.contentRevision !== null && snapshot.transcript.length === 0 && snapshot.currentQuestion === null && snapshot.answerCount === 0 && snapshot.questionCount === _QUESTION_COUNT && !snapshot.canConclude && snapshot.startedAt === null && snapshot.completedAt === null;
}

/** Whether an active chat exposes exactly its next question or exact conclusion eligibility. */
function _InProgressEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	if (!_StartedEvidence(snapshot) || snapshot.completedAt !== null) return false;
	const allAnswered = snapshot.answerCount === _QUESTION_COUNT;
	if (snapshot.canConclude !== allAnswered) return false;
	if (allAnswered) return snapshot.currentQuestion === null;
	return snapshot.currentQuestion?.ordinal === snapshot.answerCount + 1;
}

/** Whether completed onboarding retains the exact fully answered conversation and completion timestamp. */
function _CompletedEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return _BootstrapCompletionEvidence(snapshot) || _MigratedCompletionEvidence(snapshot);
}

/** Whether completed onboarding retains the exact fully answered bootstrap conversation. */
function _BootstrapCompletionEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return _StartedEvidence(snapshot) && snapshot.answerCount === _QUESTION_COUNT && snapshot.currentQuestion === null && !snapshot.canConclude && snapshot.completedAt !== null;
}

/** Whether an existing-user migration completed onboarding without inventing first-chat evidence. */
function _MigratedCompletionEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return snapshot.conversationId === null && snapshot.persona === null && snapshot.contentRevision === null && snapshot.transcript.length === 0 && snapshot.currentQuestion === null && snapshot.answerCount === 0 && snapshot.questionCount === 0 && !snapshot.canConclude && snapshot.startedAt === null && snapshot.completedAt !== null;
}

/** Whether a started or completed exchange carries its exact pinned conversation and source evidence. */
function _StartedEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	return snapshot.conversationId !== null && snapshot.persona !== null && snapshot.contentRevision !== null && snapshot.questionCount === _QUESTION_COUNT && snapshot.startedAt !== null;
}

/** Whether transcript roles, kinds, and question coordinates match the admitted answer count exactly. */
function _TranscriptMatchesEvidence(snapshot: PersonaFirstChatSnapshot): boolean
{
	if (snapshot.conversationId === null) return snapshot.transcript.length === 0;
	const expected: { readonly role: PersonaFirstChatTranscriptRoles; readonly kind: PersonaFirstChatTranscriptKinds; readonly questionOrdinal: number | null }[] =
	[
		{ role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, questionOrdinal: null }
	];
	for (let ordinal = 1; ordinal <= _QUESTION_COUNT; ordinal += 1)
	{
		if (ordinal > snapshot.answerCount + 1) break;
		expected.push({ role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, questionOrdinal: ordinal });
		if (ordinal <= snapshot.answerCount) expected.push({ role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, questionOrdinal: ordinal });
	}
	if (snapshot.transcript.length !== expected.length) return false;
	const coordinatesMatch = snapshot.transcript.every(function _Matches(entry, index)
	{
		const coordinate = expected[index];
		return coordinate !== undefined && entry.role === coordinate.role && entry.kind === coordinate.kind && entry.questionOrdinal === coordinate.questionOrdinal;
	});
	if (!coordinatesMatch || snapshot.currentQuestion === null) return coordinatesMatch;
	return snapshot.transcript.at(-1)?.text === snapshot.currentQuestion.text;
}
