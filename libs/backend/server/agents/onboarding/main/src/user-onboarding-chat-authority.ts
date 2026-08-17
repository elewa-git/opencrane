import { randomUUID } from "node:crypto";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import { UserOnboardingAnswerStatuses, UserOnboardingChatFailureReasons, UserOnboardingChatMessageKinds, UserOnboardingChatRoles, UserOnboardingStates } from "./user-onboarding.enums";
import type { ApprovedPersonaBootstrapEvidence, SubmitUserOnboardingAnswerCommand, UserOnboardingAnswerResult, UserOnboardingBootstrapContentRevision, UserOnboardingBootstrapConversation, UserOnboardingChatProjection, UserOnboardingChatRepository, UserOnboardingChatTranscriptItem } from "./user-onboarding-chat.types";
import type { UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord } from "./user-onboarding.types";
import type { __UserOnboardingAuthority } from "./user-onboarding-authority";
import { UserOnboardingReadinessStatuses, type UserOnboardingCompletionUnitOfWork } from "./user-onboarding-completion.types";

/**
 * Thrown for a refusal the router is expected to translate, not to log as a fault.
 *
 * Carrying a {@link UserOnboardingChatFailureReasons} member lets the router choose a fixed status
 * (400, 409, or 503) and send `onboarding_chat_<reason>` to the browser. Anything else thrown out of
 * the chat authority is treated as an unexpected fault: logged, and answered 503. The message
 * deliberately contains only the reason - never the user's answer text or their identifiers.
 *
 * Called by: thrown throughout __UserOnboardingChatAuthority and by the answer route in
 * user-onboarding.http.ts; caught by `_ChatRequest` in that same file.
 */
export class UserOnboardingChatError extends Error
{
	/** Stable reason used by the HTTP adapter. */
	readonly reason: UserOnboardingChatFailureReasons;

	/** Create a bounded error without owner or answer content. */
	constructor(reason: UserOnboardingChatFailureReasons)
	{
		super(`user onboarding chat denied: ${reason}`);
		this.reason = reason;
	}
}

/** Server-owned deterministic three-answer guided onboarding exchange. */
export class __UserOnboardingChatAuthority
{
	/** Durable workflow authority used to reconcile approved persona notifications. */
	private readonly onboarding: __UserOnboardingAuthority;
	/** Onboarding-owned script, conversation, answer, and completion repository. */
	private readonly repository: UserOnboardingChatRepository;
	/** Persona-owned safe display evidence port. */
	private readonly personaEvidence: UserOnboardingPersonaEvidencePort;
	/** Atomic personal-Agent provisioning and onboarding completion boundary. */
	private readonly completion: UserOnboardingCompletionUnitOfWork;

	/** Compose guided chat without a general runtime or browser-selected identifiers. */
	constructor(onboarding: __UserOnboardingAuthority, repository: UserOnboardingChatRepository, personaEvidence: UserOnboardingPersonaEvidencePort, completion: UserOnboardingCompletionUnitOfWork)
	{
		this.onboarding = onboarding;
		this.repository = repository;
		this.personaEvidence = personaEvidence;
		this.completion = completion;
	}

	/** Read the deterministic owner projection without starting or advancing the chat. */
	async read(owner: UserOnboardingOwner): Promise<UserOnboardingChatProjection>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.chat.read", _TraceOwner(owner), async function _Read()
		{
			const workflow = await self.onboarding.readOrCreate(owner);
			return self._project(owner, workflow);
		});
	}

	/** Start one onboarding-only conversation with exact owner, persona, and script pins. */
	async start(owner: UserOnboardingOwner): Promise<UserOnboardingChatProjection>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.chat.start", _TraceOwner(owner), async function _Start()
		{
			// 1. Reconcile the exact approved persona before selecting any reviewed bootstrap content.
			const workflow = await self.onboarding.readOrCreate(owner);
			if (workflow.state === UserOnboardingStates.BootstrapChatInProgress || workflow.state === UserOnboardingStates.Completed) return self._project(owner, workflow);
			if (workflow.state !== UserOnboardingStates.BootstrapChatPending || workflow.personaRevisionId === null) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.NotReady);

			// 2. Select content only from persona-owned active approved evidence; the browser supplies no coordinate.
			const selection = await self._selection(owner, workflow.personaRevisionId);

			// 3. Atomically create and pin one server-generated conversation, then recover a concurrent winner.
			const started = await self.repository.startConversation({ conversationId: randomUUID(), onboarding: workflow, persona: selection.persona, content: selection.content });
			const after = await self.onboarding.readOrCreate(owner);
			if (!started && after.state !== UserOnboardingStates.BootstrapChatInProgress && after.state !== UserOnboardingStates.Completed) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.StateConflict);
			return self._project(owner, after);
		});
	}

	/** Append one bounded answer to the next server-selected question. */
	async answer(owner: UserOnboardingOwner, command: SubmitUserOnboardingAnswerCommand): Promise<UserOnboardingAnswerResult>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.chat.answer", _TraceOwner(owner), async function _Answer()
		{
			// 1. Normalise and bound both owner-controlled fields before any persistence call.
			const expectedConversationId = _NormalisedConversationId(command.expectedConversationId);
			const expectedQuestionOrdinal = _QuestionOrdinal(command.expectedQuestionOrdinal);
			const normalisedText = _NormalisedAnswer(command.text);
			const normalisedKey = _NormalisedIdempotencyKey(command.idempotencyKey);

			// 2. Derive the next question only from the durable answer count of the pinned conversation.
			const workflow = await self.onboarding.readOrCreate(owner);
			const conversation = await self.repository.readConversation(owner);
			const answerState = workflow.state === UserOnboardingStates.BootstrapChatInProgress || workflow.state === UserOnboardingStates.Completed;
			if (!answerState || conversation === null || workflow.bootstrapConversationId !== conversation.id) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.StateConflict);
			if (conversation.id !== expectedConversationId) return { status: UserOnboardingAnswerStatuses.StateConflict, chat: await self._project(owner, workflow) };

			// 3. Append or resume at the repository boundary, then return the authoritative durable projection.
			const result = await self.repository.appendAnswer({ answerId: randomUUID(), owner, conversationId: conversation.id, questionOrdinal: expectedQuestionOrdinal, text: normalisedText, idempotencyKey: normalisedKey });
			const after = await self._project(owner, await self.onboarding.readOrCreate(owner));
			return { status: result.status, chat: after };
		});
	}

	/** Conclude only an exact three-answer conversation and complete onboarding server-side. */
	async conclude(owner: UserOnboardingOwner): Promise<UserOnboardingChatProjection>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.chat.conclude", _TraceOwner(owner), async function _Conclude()
		{
			// 1. Readiness validation and idempotent repair are part of every completed resume.
			const workflow = await self.onboarding.readOrCreate(owner);
			if (workflow.state === UserOnboardingStates.Completed) return self._project(owner, workflow);

			// 2. Require the exact pinned conversation and exactly its three reviewed ordered answers.
			const conversation = await self.repository.readConversation(owner);
			if (workflow.state !== UserOnboardingStates.BootstrapChatInProgress || conversation === null || workflow.bootstrapConversationId !== conversation.id || conversation.content.questions.length !== 3 || conversation.answers.length !== 3) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.NotConcludable);

			// 3. Provision the personal Agent and complete onboarding in one Serializable transaction.
			const completed = await self.completion.complete(owner, conversation.id, new Date());
			const after = await self.onboarding.readOrCreate(owner);
			if (completed.status !== UserOnboardingReadinessStatuses.Ready || after.state !== UserOnboardingStates.Completed) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.EvidenceUnavailable);
			return self._project(owner, after);
		});
	}

	/** Resolve the immutable script and safe persona label from the exact pinned approved revision. */
	private async _selection(owner: UserOnboardingOwner, personaRevisionId: string): Promise<{ readonly persona: ApprovedPersonaBootstrapEvidence; readonly content: UserOnboardingBootstrapContentRevision }>
	{
		const persona = await this.personaEvidence.readApprovedBootstrapEvidence(owner, personaRevisionId);
		if (persona === null || persona.personaRevisionId !== personaRevisionId) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.EvidenceUnavailable);
		const content = await this.repository.readContentForColour(persona.primaryColour);
		if (content === null || content.primaryColour !== persona.primaryColour || content.archetype !== persona.archetype || content.questions.length !== 3) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.EvidenceUnavailable);
		return { persona, content };
	}

	/** Project pending selection or a durable conversation through one deterministic renderer. */
	private async _project(owner: UserOnboardingOwner, workflow: UserOnboardingRecord): Promise<UserOnboardingChatProjection>
	{
		const conversation = await this.repository.readConversation(owner);
		if (conversation !== null)
		{
			if (conversation.onboardingId !== workflow.id || workflow.bootstrapConversationId !== conversation.id || workflow.bootstrapContentRevisionId !== conversation.content.id || workflow.bootstrapContentDigest !== conversation.content.digest || workflow.personaRevisionId !== conversation.personaRevisionId) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.EvidenceUnavailable);
			return _ConversationProjection(workflow, conversation);
		}
		if (workflow.state !== UserOnboardingStates.BootstrapChatPending || workflow.personaRevisionId === null) return _EmptyProjection(workflow);
		const selection = await this._selection(owner, workflow.personaRevisionId);
		return _PendingProjection(workflow, selection.persona, selection.content);
	}
}

/** Build a routeable projection before the persona survey is approved. */
function _EmptyProjection(workflow: UserOnboardingRecord): UserOnboardingChatProjection
{
	return { workflowVersion: workflow.workflowVersion, state: workflow.state, conversationId: null, persona: null, contentRevision: null, transcript: [], currentQuestion: null, answerCount: 0, questionCount: 0, canConclude: false, startedAt: null, completedAt: workflow.completedAt?.toISOString() ?? null };
}

/** Show the selected immutable persona and script without starting a conversation. */
function _PendingProjection(workflow: UserOnboardingRecord, persona: ApprovedPersonaBootstrapEvidence, content: UserOnboardingBootstrapContentRevision): UserOnboardingChatProjection
{
	return { workflowVersion: workflow.workflowVersion, state: workflow.state, conversationId: null, persona: { revisionId: persona.personaRevisionId, displayName: persona.displayName, archetype: persona.archetype, primaryColour: persona.primaryColour }, contentRevision: _ContentProjection(content), transcript: [], currentQuestion: null, answerCount: 0, questionCount: content.questions.length, canConclude: false, startedAt: null, completedAt: null };
}

/** Render a durable conversation deterministically from immutable source plus ordered answers. */
function _ConversationProjection(workflow: UserOnboardingRecord, conversation: UserOnboardingBootstrapConversation): UserOnboardingChatProjection
{
	const transcript = _Transcript(conversation);
	const current = conversation.content.questions[conversation.answers.length];
	return { workflowVersion: workflow.workflowVersion, state: workflow.state, conversationId: conversation.id, persona: { revisionId: conversation.personaRevisionId, displayName: conversation.personaDisplayName, archetype: conversation.personaArchetype, primaryColour: conversation.content.primaryColour }, contentRevision: _ContentProjection(conversation.content), transcript, currentQuestion: current === undefined ? null : { ordinal: current.ordinal, text: current.prompt }, answerCount: conversation.answers.length, questionCount: conversation.content.questions.length, canConclude: workflow.state === UserOnboardingStates.BootstrapChatInProgress && conversation.answers.length === conversation.content.questions.length, startedAt: conversation.startedAt.toISOString(), completedAt: workflow.completedAt?.toISOString() ?? null };
}

/** Expose only immutable source identity, not hidden canonical source or author guidance. */
function _ContentProjection(content: UserOnboardingBootstrapContentRevision): { readonly id: string; readonly digest: string; readonly sourceLabel: string }
{
	return { id: content.id, digest: content.digest, sourceLabel: content.sourceLabel };
}

/** Rebuild only literal reviewed dialogue and owner answers; author guidance is never a message. */
function _Transcript(conversation: UserOnboardingBootstrapConversation): readonly UserOnboardingChatTranscriptItem[]
{
	const transcript: UserOnboardingChatTranscriptItem[] = [{ ordinal: 1, role: UserOnboardingChatRoles.Assistant, kind: UserOnboardingChatMessageKinds.Opening, text: conversation.content.opening, questionOrdinal: null }];
	for (const question of conversation.content.questions)
	{
		const answer = conversation.answers.find(candidate => candidate.questionOrdinal === question.ordinal);
		if (answer === undefined && question.ordinal > conversation.answers.length + 1) break;
		transcript.push({ ordinal: transcript.length + 1, role: UserOnboardingChatRoles.Assistant, kind: UserOnboardingChatMessageKinds.Question, text: question.prompt, questionOrdinal: question.ordinal });
		if (answer !== undefined) transcript.push({ ordinal: transcript.length + 1, role: UserOnboardingChatRoles.User, kind: UserOnboardingChatMessageKinds.Answer, text: answer.text, questionOrdinal: question.ordinal });
	}
	return transcript;
}

/** Trim one answer while enforcing the server's bounded evidence size. */
function _NormalisedAnswer(text: string): string
{
	const normalised = text.trim();
	if (normalised.length === 0 || normalised.length > 4000) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.InvalidAnswer);
	return normalised;
}

/** Require the exact non-empty server-issued conversation coordinate. */
function _NormalisedConversationId(conversationId: string): string
{
	const normalised = conversationId.trim();
	if (normalised.length === 0 || normalised.length > 128) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.InvalidCoordinate);
	return normalised;
}

/** Require one of the three reviewed server-issued question coordinates. */
function _QuestionOrdinal(questionOrdinal: number): number
{
	if (!Number.isSafeInteger(questionOrdinal) || questionOrdinal < 1 || questionOrdinal > 3) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.InvalidCoordinate);
	return questionOrdinal;
}

/** Trim one retry key while enforcing its conversation-local bounded size. */
function _NormalisedIdempotencyKey(idempotencyKey: string): string
{
	const normalised = idempotencyKey.trim();
	if (normalised.length === 0 || normalised.length > 128) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.InvalidIdempotencyKey);
	return normalised;
}

/** Keep traces owner-bound and free from submitted chat content. */
function _TraceOwner(owner: UserOnboardingOwner): Record<string, unknown>
{
	return { siloId: owner.siloId, subjectId: owner.subjectId };
}
