import type { CompletePersonaInterviewCommand, CompletePersonaInterviewResult, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, RecordPersonaInterviewAnswerResult, ResolvePersonaInterviewTieCommand, ResolvePersonaInterviewTieResult, StartPersonaInterviewCommand, StartPersonaInterviewResult } from "./persona-interview-authority.types.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/**
 * Starts the owner's persona onboarding interview, or returns the one they already have open.
 *
 * The question set, scoring policy, and interpolation map are pinned to the interview here and never
 * change afterwards, so the draft derived at the end always matches the questions the owner actually
 * saw. The router fills those ids in from the server-owned catalogue; a browser never chooses them.
 *
 * Calling this twice is safe: the second call returns `AlreadyInProgress` with the existing interview
 * id rather than starting a second one.
 *
 * Called by: the POST /me/persona/interview and
 * POST /me/persona/refreshes/{configurationChangeId}/interview routes in persona-onboarding.router.ts.
 *
 * @param repository - Performs the start inside one Serializable transaction.
 * @param command - Owner and silo, the pinned catalogue ids and versions, an optional accepted
 * persona-refresh proposal, and the server timestamp.
 * @returns `Started` with a new interview id, or `AlreadyInProgress` with the existing one — treat
 * both as success and send the owner to the interview. `Denied` with a
 * {@link PersonaInterviewDenialReasons}: `RefreshInterviewConflict` means the owner has an interview
 * open for a different refresh and must finish or abandon it first, `QuestionSetUnavailable` means the
 * catalogue is not seeded, and `Conflict` is retryable. Never throws.
 * @see PersonaInterviewRepository
 */
export async function __StartPersonaInterview(repository: PersonaInterviewRepository, command: StartPersonaInterviewCommand): Promise<StartPersonaInterviewResult>
{
	if (!_validStart(command)) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaInterviewDenialReasons.InvalidCommand };
	const result = await repository.startAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Started || result.status === PersonaLifecycleOutcomes.AlreadyInProgress ? { outcome: result.status, interviewId: result.interviewId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/**
 * Records the owner's answer to one interview question.
 *
 * An answer cannot be changed once written, and a question can only be answered once, so the caller
 * must treat `AlreadyAnswered` as the owner having already made this choice rather than as an error to
 * retry. The choice must belong to the question, and the question to the question-set version the
 * interview was pinned to when it started.
 *
 * Called by: the POST /me/persona/interviews/{interviewId}/answers/{questionId} route in
 * persona-onboarding.router.ts.
 *
 * @param repository - Performs the append inside one Serializable transaction.
 * @param command - Owner, profile, interview, question, choice, and the server timestamp.
 * @returns `Recorded` with the new answer id. `Denied` with a
 * {@link PersonaInterviewDenialReasons}: `AlreadyAnswered` means this question is already settled,
 * `QuestionUnavailable` means the choice does not belong to the interview's pinned question set,
 * `NotInProgress` means the interview has been completed, and `Conflict` is retryable. Never throws.
 * @see PersonaInterviewRepository
 */
export async function __RecordPersonaInterviewAnswer(repository: PersonaInterviewRepository, command: RecordPersonaInterviewAnswerCommand): Promise<RecordPersonaInterviewAnswerResult>
{
	if (!_validAnswer(command)) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaInterviewDenialReasons.InvalidCommand };
	const result = await repository.recordAnswerAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Recorded ? { outcome: PersonaLifecycleOutcomes.Recorded, answerId: result.answerId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/**
 * Freezes a fully answered interview and returns its first score.
 *
 * The repository re-counts the answers against the interview's pinned question set inside its own
 * transaction, and a database trigger counts them again on the update, so an answer written
 * concurrently cannot slip past. After this succeeds the interview can never accept another answer.
 *
 * A returned score may still be ambiguous. When `score.resolutionRequired` is not null the owner must
 * break that tie before a draft can be created — completing the interview is not the same as having a
 * usable result.
 *
 * Called by: the POST /me/persona/interviews/{interviewId}/complete route in
 * persona-onboarding.router.ts.
 *
 * @param repository - Performs the completion and first scoring inside one Serializable transaction.
 * @param command - Owner, profile, interview, and the server timestamp.
 * @returns `Completed` with the score; check `resolutionRequired` before offering a draft. `Denied`
 * with a {@link PersonaInterviewDenialReasons}: `IncompleteAnswers` means questions are still
 * unanswered, `NotInProgress` means it was already completed, and `Conflict` is retryable. Never
 * throws.
 * @see PersonaScoreResult
 */
export async function __CompletePersonaInterview(repository: PersonaInterviewRepository, command: CompletePersonaInterviewCommand): Promise<CompletePersonaInterviewResult>
{
	if (!_validCompletion(command)) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaInterviewDenialReasons.InvalidCommand };
	const result = await repository.completeAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Completed ? { outcome: PersonaLifecycleOutcomes.Completed, score: result.score } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/**
 * Records the owner's choice for the tie the score is currently waiting on.
 *
 * Ties are broken one at a time, in a fixed order: primary colour, then secondary colour, then
 * modifier. A choice for any tie other than the one the score is waiting on is refused, and a choice
 * recorded against a stale candidate list is refused too, so a browser showing an out-of-date
 * question cannot corrupt the result.
 *
 * The returned score may still have another tie open. The caller must keep checking
 * `resolutionRequired` until it is null before offering a draft.
 *
 * Called by: the POST /me/persona/interviews/{interviewId}/resolutions/{kind} route in
 * persona-onboarding.router.ts.
 *
 * @param repository - Performs the append inside one Serializable transaction.
 * @param command - Owner, profile, interview, which tie, the chosen value, and the server timestamp.
 * @returns `Recorded` with the recomputed score. `Denied` with a
 * {@link PersonaInterviewDenialReasons}: `InvalidResolution` means the tie or candidate does not match
 * what the score is waiting on and the owner needs a fresh status read, `AlreadyResolved` means this
 * tie is already settled, and `Conflict` is retryable. Never throws.
 * @see PersonaTieKinds
 */
export async function __ResolvePersonaInterviewTie(repository: PersonaInterviewRepository, command: ResolvePersonaInterviewTieCommand): Promise<ResolvePersonaInterviewTieResult>
{
	if (!_validResolution(command)) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaInterviewDenialReasons.InvalidCommand };
	const result = await repository.resolveTieAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Recorded ? { outcome: PersonaLifecycleOutcomes.Recorded, score: result.score } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/** Returns whether the start request has every identifier, positive version numbers, and a parseable timestamp. */
function _validStart(command: StartPersonaInterviewCommand): boolean
{
	return _validIdentifier(command.siloId) && _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.questionSetId) && _validIdentifier(command.scoringPolicyId) && _validIdentifier(command.interpolationMapId) && (command.refreshConfigurationChangeId === null || _validIdentifier(command.refreshConfigurationChangeId)) && [command.questionSetVersion, command.scoringPolicyVersion, command.interpolationMapVersion].every(function _ValidVersion(version) { return Number.isSafeInteger(version) && version > 0; }) && _validInstant(command.startedAt);
}

/** Returns whether the answer request has every identifier and a parseable timestamp. */
function _validAnswer(command: RecordPersonaInterviewAnswerCommand): boolean
{
	return _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.interviewId) && _validIdentifier(command.questionId) && _validIdentifier(command.choiceId) && _validInstant(command.answeredAt);
}

/** Returns whether the completion request has its identifiers and a parseable timestamp. */
function _validCompletion(command: CompletePersonaInterviewCommand): boolean
{
	return _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.interviewId) && _validInstant(command.completedAt);
}

/** Returns whether the tie-choice request has its identifiers and a parseable timestamp. */
function _validResolution(command: ResolvePersonaInterviewTieCommand): boolean
{
	return _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.interviewId) && _validIdentifier(command.kind) && _validIdentifier(command.selectedValue) && _validInstant(command.resolvedAt);
}

/** Returns whether an identifier is non-blank and at most 200 characters. No format is assumed. */
function _validIdentifier(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}

/** Returns whether a timestamp string can be parsed. */
function _validInstant(value: string): boolean
{
	return Number.isFinite(Date.parse(value));
}
