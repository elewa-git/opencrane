import { PersonaOnboardingApiStates } from "./persona-lifecycle.types";
import { PersonaOnboardingStatusInterviewStates, PersonaOnboardingStatusProjectionStates, PersonaOnboardingStatusRevisionStates } from "./persona-onboarding-status-projection.types";
import type { PersonaOnboardingStatusFacts, PersonaOnboardingStatusProjectionState } from "./persona-onboarding-status-projection.types";
import type { PersonaOnboardingStatus } from "./persona-onboarding-status.types";

/** Turns the loaded facts into the status the owner sees, by first working out which of the nine situations they are in. */
export function _ProjectPersonaOnboardingStatus(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
{
	return _PROJECTION_STATES[_ClassifyProjectionState(facts)].project(facts);
}

/** Works out which situation the loaded facts describe. */
function _ClassifyProjectionState(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatusProjectionStates
{
	if (!facts.hasProfile) return PersonaOnboardingStatusProjectionStates.NoProfile;
	if (facts.interview === null) return facts.activeRevisionId === null ? PersonaOnboardingStatusProjectionStates.NoInterview : PersonaOnboardingStatusProjectionStates.ActivePersona;
	if (facts.revision !== null) return facts.revision.state === PersonaOnboardingStatusRevisionStates.Draft ? PersonaOnboardingStatusProjectionStates.DraftRevision : PersonaOnboardingStatusProjectionStates.ApprovedRevision;
	if (facts.interview.state === PersonaOnboardingStatusInterviewStates.InProgress) return PersonaOnboardingStatusProjectionStates.InterviewInProgress;
	if (facts.score === null) return PersonaOnboardingStatusProjectionStates.ScoreUnavailable;
	return facts.score.resolutionRequired === null ? PersonaOnboardingStatusProjectionStates.ScoreReady : PersonaOnboardingStatusProjectionStates.ResolutionRequired;
}

/** Projection for a missing owner persona profile. */
class _NoProfileProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the empty starting status, revealing nothing about the profile. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _EmptyStatus();
	}
}

/** Projection for a profile with no interview or active persona result. */
class _NoInterviewProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the empty starting status. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _EmptyStatus();
	}
}

/** Projection for an active persona that has no newer interview. */
class _ActivePersonaProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the ready status, carrying only the active revision id. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return { ..._EmptyStatus(), state: PersonaOnboardingApiStates.Ready, personaRevisionId: facts.activeRevisionId };
	}
}

/** Projection for a draft revision awaiting owner approval. */
class _DraftRevisionProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the review status with the draft revision's result. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _RevisionStatus(facts, PersonaOnboardingApiStates.Review);
	}
}

/** Projection for an approved revision. */
class _ApprovedRevisionProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the ready status with the approved revision's result. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _RevisionStatus(facts, PersonaOnboardingApiStates.Ready);
	}
}

/** Projection for an interview that can still accept reviewed answers. */
class _InterviewInProgressProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Return the resumable interview route. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _InterviewStatus(facts);
	}
}

/** Projection for a completed interview whose score cannot yet be replayed. */
class _ScoreUnavailableProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Falls back to the interview status rather than making up a score. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _InterviewStatus(facts);
	}
}

/** Status for a score that ended in a tie the owner must break. */
class _ResolutionRequiredProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Returns the next tie plus the score, so the owner can choose. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _ScoredStatus(facts, PersonaOnboardingApiStates.Resolution);
	}
}

/** Projection for a completed score that may now be turned into a reviewable draft. */
class _ScoreReadyProjectionState implements PersonaOnboardingStatusProjectionState
{
	/** Return the review route with fully resolved score evidence. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
	{
		return _ScoredStatus(facts, PersonaOnboardingApiStates.Review);
	}
}

/** One projection object per situation. */
const _PROJECTION_STATES: Readonly<Record<PersonaOnboardingStatusProjectionStates, PersonaOnboardingStatusProjectionState>> = {
	[PersonaOnboardingStatusProjectionStates.NoProfile]: new _NoProfileProjectionState(),
	[PersonaOnboardingStatusProjectionStates.NoInterview]: new _NoInterviewProjectionState(),
	[PersonaOnboardingStatusProjectionStates.ActivePersona]: new _ActivePersonaProjectionState(),
	[PersonaOnboardingStatusProjectionStates.DraftRevision]: new _DraftRevisionProjectionState(),
	[PersonaOnboardingStatusProjectionStates.ApprovedRevision]: new _ApprovedRevisionProjectionState(),
	[PersonaOnboardingStatusProjectionStates.InterviewInProgress]: new _InterviewInProgressProjectionState(),
	[PersonaOnboardingStatusProjectionStates.ScoreUnavailable]: new _ScoreUnavailableProjectionState(),
	[PersonaOnboardingStatusProjectionStates.ResolutionRequired]: new _ResolutionRequiredProjectionState(),
	[PersonaOnboardingStatusProjectionStates.ScoreReady]: new _ScoreReadyProjectionState(),
};

/** Returns the empty starting status. */
function _EmptyStatus(): PersonaOnboardingStatus
{
	return { state: PersonaOnboardingApiStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null, questions: [], resolution: null, result: null };
}

/** Build a review or ready status from validated revision facts. */
function _RevisionStatus(facts: PersonaOnboardingStatusFacts, state: PersonaOnboardingApiStates.Review | PersonaOnboardingApiStates.Ready): PersonaOnboardingStatus
{
	if (facts.interview === null || facts.revision === null) throw new Error("revision projection requires interview and revision facts");
	return { state, interviewId: facts.interview.id, answeredQuestionCount: facts.interview.answeredQuestionCount, questionCount: facts.interview.questions.length, personaRevisionId: facts.revision.id, questions: facts.interview.questions, resolution: null, result: facts.revision.result };
}

/** Builds the resumable interview status. Throws when the interview facts are missing. */
function _InterviewStatus(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus
{
	if (facts.interview === null) throw new Error("interview projection requires interview facts");
	return { state: PersonaOnboardingApiStates.Interview, interviewId: facts.interview.id, answeredQuestionCount: facts.interview.answeredQuestionCount, questionCount: facts.interview.questions.length, personaRevisionId: null, questions: facts.interview.questions, resolution: null, result: null };
}

/** Build a resolved-score or resolution-required status from replayed score evidence. */
function _ScoredStatus(facts: PersonaOnboardingStatusFacts, state: PersonaOnboardingApiStates.Resolution | PersonaOnboardingApiStates.Review): PersonaOnboardingStatus
{
	if (facts.interview === null || facts.score === null) throw new Error("score projection requires interview and score facts");
	return { state, interviewId: facts.interview.id, answeredQuestionCount: facts.interview.answeredQuestionCount, questionCount: facts.interview.questions.length, personaRevisionId: null, questions: facts.interview.questions, resolution: facts.score.resolutionRequired, result: _ScoreResult(facts.score) };
}

/** Builds the owner-visible result, or null while any tie is still open. */
function _ScoreResult(score: NonNullable<PersonaOnboardingStatusFacts["score"]>): PersonaOnboardingStatus["result"]
{
	if (score.primary === null || score.secondary === null || score.modifier === null) return null;
	return { displayName: "Persona result", primaryColour: score.primary, secondaryColour: score.secondary, modifier: score.modifier, colourScores: score.colours, opennessScores: score.openness, insights: [], instructionPreview: null };
}
