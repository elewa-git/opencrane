import type { AcceptPreferenceFactCommand, AcceptPreferenceFactResult, ForgetPreferenceFactCommand, ForgetPreferenceFactResult, PreferenceFactRepository, RecordPreferenceFactCommand, RecordPreferenceFactResult } from "./preference-fact-authority.types.js";

/** Promotes a user-confirmed candidate so a later immutable snapshot may include it. */
export async function __AcceptPreferenceFact(repository: PreferenceFactRepository, command: AcceptPreferenceFactCommand): Promise<AcceptPreferenceFactResult>
{
	// 1. Require explicit confirmation coordinates before the candidate lifecycle transition starts.
	if (![command.siloId, command.userId, command.personaProfileId, command.preferenceFactId, command.acceptedBy].every(function _identifier(value): boolean { return value.trim().length > 0 && value.length <= 200; }) || command.acceptedBy !== command.userId || !Number.isFinite(Date.parse(command.acceptedAt))) return { outcome: "denied", reason: "invalid_command" };

	// 2. Apply the owner-scoped promotion; the baseline repeats consent and lifecycle checks.
	const result = await repository.acceptAtomically(command);
	return result.status === "accepted" ? { outcome: "accepted" } : { outcome: "denied", reason: result.status };
}

/** Records one explainable personal preference for future immutable snapshots. */
export async function __RecordPreferenceFact(repository: PreferenceFactRepository, command: RecordPreferenceFactCommand): Promise<RecordPreferenceFactResult>
{
	// 1. Reject malformed or unsafe facts before the durable authority can create a candidate.
	if (!_isRecordValid(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Persist the immutable evidence and correction lineage through the sole preference authority.
	const result = await repository.recordAtomically(command);
	if (result.status === "recorded") return { outcome: "recorded", preferenceFactId: result.preferenceFactId, idempotent: false };
	if (result.status === "idempotent") return { outcome: "recorded", preferenceFactId: result.preferenceFactId, idempotent: true };
	return { outcome: "denied", reason: result.status };
}

/** Marks a fact unavailable to later admissions while preserving historical snapshot evidence. */
export async function __ForgetPreferenceFact(repository: PreferenceFactRepository, command: ForgetPreferenceFactCommand): Promise<ForgetPreferenceFactResult>
{
	// 1. Keep owner coordinates bounded before any durable lifecycle transition.
	if (!_isForgetValid(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Apply only the explicit forget transition; no snapshot or fact row is deleted.
	const result = await repository.forgetAtomically(command);
	return result.status === "forgotten" ? { outcome: "forgotten" } : { outcome: "denied", reason: result.status };
}

/** Validates user-controlled fact contents and the provenance/consent combination. */
function _isRecordValid(command: RecordPreferenceFactCommand): boolean
{
	const provenance = command.provenance;
	const identifiers = [command.siloId, command.userId, command.personaProfileId, command.preferenceKey, command.statement, command.recordedBy, command.idempotencyKey];
	const identifiersValid = identifiers.every(function _identifier(value): boolean { return value.trim().length > 0 && value.length <= 2000; });
	const sourceValid = (provenance.kind === "explicit_statement" && provenance.messageId === null && provenance.interviewId === null)
		|| ((provenance.kind === "conversation_message" || provenance.kind === "inferred") && _optionalIdentifier(provenance.messageId) && provenance.interviewId === null)
		|| (provenance.kind === "interview" && provenance.messageId === null && _optionalIdentifier(provenance.interviewId));
	const consentValid = command.state === "candidate" ? command.consentState === "pending" : command.consentState === "explicit" || command.consentState === "confirmed";
	const acceptanceValid = command.state !== "accepted" || (_optionalIdentifier(command.acceptedBy) && command.acceptedBy === command.userId);
	const correctionValid = command.supersedesFactId === null || (command.state === "accepted" && command.consentState !== "pending" && command.acceptedBy === command.userId);
	return identifiersValid && (command.state === "accepted" ? acceptanceValid : command.acceptedBy === null) && sourceValid && consentValid && correctionValid && Number.isFinite(command.confidence) && command.confidence >= 0 && command.confidence <= 1 && !(command.sensitivity === "sensitive" && provenance.kind === "inferred") && (command.supersedesFactId === null || _optionalIdentifier(command.supersedesFactId));
}

/** Validates an explicit forget request before its lifecycle authority is called. */
function _isForgetValid(command: ForgetPreferenceFactCommand): boolean
{
	return [command.siloId, command.userId, command.personaProfileId, command.preferenceFactId].every(_optionalIdentifier) && Number.isFinite(Date.parse(command.forgottenAt));
}

/** Validates an opaque persisted identifier without assuming a storage format. */
function _optionalIdentifier(value: string | null): value is string
{
	return value !== null && value.trim().length > 0 && value.length <= 200;
}
