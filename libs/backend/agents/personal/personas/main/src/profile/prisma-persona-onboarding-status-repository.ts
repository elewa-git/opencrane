import { PersonaColour, PersonaInterviewState, PersonaOpennessModifier, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository";
import { PersonaColourValues, PersonaModifierValues, type PersonaScoreResult } from "../scoring/persona-scorer.types";
import { _ParsePersonaPersistedScoreEvidence } from "../scoring/persona-scorer.validator";
import { _ProjectPersonaOnboardingStatus } from "./persona-onboarding-status-projection";
import { PersonaOnboardingStatusInterviewStates, PersonaOnboardingStatusRevisionStates } from "./persona-onboarding-status-projection.types";
import type { PersonaOnboardingStatus, PersonaOnboardingStatusRepository, PersonaStatusQuestion, PersonaStatusResult } from "./persona-onboarding-status.types";

/** Prisma read adapter for the exact owner's resumable persona state. */
export class PrismaPersonaOnboardingStatusRepository implements PersonaOnboardingStatusRepository
{
	/** Transaction-scoped ORM client supplied by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Score repository, used to recompute a completed interview's score. */
	private readonly scoring: PrismaPersonaScoringRepository;

	/** Construct the status reader over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.scoring = new PrismaPersonaScoringRepository(this.transaction);
	}

	/** Read frozen questions, progress, tie state, and review result without persona instructions. */
	async readStatus(siloId: string, userId: string): Promise<PersonaOnboardingStatus>
	{
		const profile = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId, userId } }, select: { id: true, activeRevisionId: true, interviews: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, state: true, answers: { select: { questionId: true, choiceId: true } }, questionSet: { select: { questions: { select: { id: true, category: true, prompt: true, ordinal: true, choices: { select: { id: true, label: true, ordinal: true }, orderBy: { ordinal: "asc" } } }, orderBy: { ordinal: "asc" } } } } } } } });
		if (profile === null) return _ProjectPersonaOnboardingStatus({ hasProfile: false, activeRevisionId: null, interview: null, revision: null, score: null });
		const interview = profile.interviews[0];
		if (interview === undefined) return _ProjectPersonaOnboardingStatus({ hasProfile: true, activeRevisionId: profile.activeRevisionId, interview: null, revision: null, score: null });
		const selected = new Map(interview.answers.map(function _Answer(answer) { return [answer.questionId, answer.choiceId]; }));
		const questions: readonly PersonaStatusQuestion[] = interview.questionSet.questions.map(function _Question(question) { return { ...question, selectedChoiceId: selected.get(question.id) ?? null }; });
		const revision = await this.transaction.personaRevision.findFirst({ where: { personaProfileId: profile.id, interviewId: interview.id }, orderBy: { revision: "desc" }, select: { id: true, state: true, primaryColour: true, secondaryColour: true, modifier: true, compiledInstructions: true, soulTemplate: { select: { displayName: true } }, scoringEvidence: true, insights: { select: { statement: true }, orderBy: { id: "asc" } } } });
		const statusInterview = { id: interview.id, state: _InterviewState(interview.state), answeredQuestionCount: interview.answers.length, questions };
		if (revision !== null)
		{
			const result = _RevisionResult(revision);
			if (result === null) throw new Error("Persona revision carries invalid scoring evidence");
			return _ProjectPersonaOnboardingStatus({ hasProfile: true, activeRevisionId: profile.activeRevisionId, interview: statusInterview, revision: { id: revision.id, state: _RevisionState(revision.state), result }, score: null });
		}
		const score = await this._readCompletedScore(interview.id, profile.id, userId, statusInterview.state);
		return _ProjectPersonaOnboardingStatus({ hasProfile: true, activeRevisionId: profile.activeRevisionId, interview: statusInterview, revision: null, score });
	}

	/** Reads the score only once the interview is completed; returns null while it is still in progress. */
	private async _readCompletedScore(interviewId: string, personaProfileId: string, userId: string, interviewState: PersonaOnboardingStatusInterviewStates): Promise<PersonaScoreResult | null>
	{
		if (interviewState === PersonaOnboardingStatusInterviewStates.InProgress) return null;
		const scored = await this.scoring.readScore(interviewId, personaProfileId, userId);
		return scored.status === PersonaScoringPersistenceStatuses.Ready ? scored.score : null;
	}
}

/** Converts Prisma's interview state into the projection enum. */
function _InterviewState(state: PersonaInterviewState): PersonaOnboardingStatusInterviewStates
{
	return state === PersonaInterviewState.InProgress ? PersonaOnboardingStatusInterviewStates.InProgress : PersonaOnboardingStatusInterviewStates.Completed;
}

/** Converts Prisma's revision state into the projection enum. */
function _RevisionState(state: PersonaRevisionState): PersonaOnboardingStatusRevisionStates
{
	return state === PersonaRevisionState.Draft ? PersonaOnboardingStatusRevisionStates.Draft : PersonaOnboardingStatusRevisionStates.Approved;
}

/** Builds the owner-visible result from a revision row. Returns null when the stored score JSON fails to parse, disagrees with the revision's own colour columns, or the insight count is outside three to five. */
function _RevisionResult(revision: { readonly primaryColour: PersonaColour; readonly secondaryColour: PersonaColour; readonly modifier: PersonaOpennessModifier; readonly compiledInstructions: string; readonly soulTemplate: { readonly displayName: string }; readonly scoringEvidence: Prisma.JsonValue; readonly insights: readonly { readonly statement: string }[] }): PersonaStatusResult | null
{
	const evidence = _ParsePersonaPersistedScoreEvidence(revision.scoringEvidence);
	if (evidence === null) return null;
	const primaryColour = _PersonaColour(revision.primaryColour);
	const secondaryColour = _PersonaColour(revision.secondaryColour);
	const modifier = _PersonaModifier(revision.modifier);
	if (evidence.primary !== primaryColour || evidence.secondary !== secondaryColour || evidence.modifier !== modifier) return null;
	if (revision.insights.length < 3 || revision.insights.length > 5) return null;
	return { displayName: revision.soulTemplate.displayName, primaryColour, secondaryColour, modifier, colourScores: evidence.colours, opennessScores: evidence.openness, insights: revision.insights.map(function _Insight(insight) { return insight.statement; }), instructionPreview: revision.compiledInstructions };
}

/** Converts a Prisma colour into the persona API value. */
function _PersonaColour(value: PersonaColour): PersonaColourValues
{
	return { [PersonaColour.Red]: PersonaColourValues.Red, [PersonaColour.Yellow]: PersonaColourValues.Yellow, [PersonaColour.Green]: PersonaColourValues.Green, [PersonaColour.Blue]: PersonaColourValues.Blue }[value];
}

/** Converts a Prisma modifier into the persona API value. */
function _PersonaModifier(value: PersonaOpennessModifier): PersonaModifierValues
{
	return { [PersonaOpennessModifier.Explorer]: PersonaModifierValues.Explorer, [PersonaOpennessModifier.Guardian]: PersonaModifierValues.Guardian }[value];
}
