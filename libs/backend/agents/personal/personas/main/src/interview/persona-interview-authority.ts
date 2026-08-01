import type { CompletePersonaInterviewCommand, CompletePersonaInterviewResult, PersonaInterviewRepository, RecordPersonaInterviewAnswerCommand, RecordPersonaInterviewAnswerResult, StartPersonaInterviewCommand, StartPersonaInterviewResult } from "./persona-interview-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Start one reviewed onboarding interview without exposing question-set authority to callers. */
export async function __StartPersonaInterview(repository: PersonaInterviewRepository, command: StartPersonaInterviewCommand): Promise<StartPersonaInterviewResult>
{
	if (!_validStart(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.startAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Started || result.status === PersonaLifecycleOutcomes.AlreadyInProgress ? { outcome: result.status, interviewId: result.interviewId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/** Record one immutable owner answer against an in-progress onboarding interview. */
export async function __RecordPersonaInterviewAnswer(repository: PersonaInterviewRepository, command: RecordPersonaInterviewAnswerCommand): Promise<RecordPersonaInterviewAnswerResult>
{
	if (!_validAnswer(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.recordAnswerAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Recorded ? { outcome: PersonaLifecycleOutcomes.Recorded, answerId: result.answerId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/** Complete an owner interview only after the persistence authority has rechecked every answer. */
export async function __CompletePersonaInterview(repository: PersonaInterviewRepository, command: CompletePersonaInterviewCommand): Promise<CompletePersonaInterviewResult>
{
	if (!_validCompletion(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.completeAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Completed ? { outcome: PersonaLifecycleOutcomes.Completed } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}

/** Return whether every start coordinate and instant is safely present. */
function _validStart(command: StartPersonaInterviewCommand): boolean
{
	return _validIdentifier(command.siloId) && _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.questionSetId) && (command.refreshConfigurationChangeId === null || _validIdentifier(command.refreshConfigurationChangeId)) && Number.isSafeInteger(command.questionSetVersion) && command.questionSetVersion > 0 && _validInstant(command.startedAt);
}

/** Return whether one answer remains bounded enough for durable interview evidence. */
function _validAnswer(command: RecordPersonaInterviewAnswerCommand): boolean
{
	return _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.interviewId) && _validIdentifier(command.questionId) && command.value.trim().length > 0 && command.value.length <= 4_000 && _validInstant(command.answeredAt);
}

/** Return whether an owner completion request names one valid frozen instant. */
function _validCompletion(command: CompletePersonaInterviewCommand): boolean
{
	return _validIdentifier(command.userId) && _validIdentifier(command.personaProfileId) && _validIdentifier(command.interviewId) && _validInstant(command.completedAt);
}

/** Validate a bounded opaque durable identifier without inventing its syntax. */
function _validIdentifier(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}

/** Validate an ISO-compatible trusted instant before any authority read. */
function _validInstant(value: string): boolean
{
	return Number.isFinite(Date.parse(value));
}
