import { PersonaColour, PersonaInterviewState, PersonaOpennessModifier, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";
import { PersonaColourValues, PersonaModifierValues, type PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import { _ParsePersonaPersistedScoreEvidence } from "../scoring/persona-scorer.validator.js";
import { _ProjectPersonaOnboardingStatus } from "./persona-onboarding-status-projection.js";
import { PersonaOnboardingStatusInterviewStates, PersonaOnboardingStatusRevisionStates } from "./persona-onboarding-status-projection.types.js";
import type { PersonaOnboardingStatus, PersonaOnboardingStatusRepository, PersonaStatusQuestion, PersonaStatusResult } from "./persona-onboarding-status.types.js";

/** Prisma read adapter for the exact owner's resumable persona state. */
export class PrismaPersonaOnboardingStatusRepository implements PersonaOnboardingStatusRepository
{
	/** Transaction-scoped ORM client supplied by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Domain score replay for completed interview status. */
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

	/** Read score evidence only after the interview becomes immutable enough to support it. */
	private async _readCompletedScore(interviewId: string, personaProfileId: string, userId: string, interviewState: PersonaOnboardingStatusInterviewStates): Promise<PersonaScoreResult | null>
	{
		if (interviewState === PersonaOnboardingStatusInterviewStates.InProgress) return null;
		const scored = await this.scoring.readScore(interviewId, personaProfileId, userId);
		return scored.status === PersonaScoringPersistenceStatuses.Ready ? scored.score : null;
	}
}

/** Map Prisma's interview state at the persistence edge before pure domain projection. */
function _InterviewState(state: PersonaInterviewState): PersonaOnboardingStatusInterviewStates
{
	return state === PersonaInterviewState.InProgress ? PersonaOnboardingStatusInterviewStates.InProgress : PersonaOnboardingStatusInterviewStates.Completed;
}

/** Map Prisma's revision state at the persistence edge before pure domain projection. */
function _RevisionState(state: PersonaRevisionState): PersonaOnboardingStatusRevisionStates
{
	return state === PersonaRevisionState.Draft ? PersonaOnboardingStatusRevisionStates.Draft : PersonaOnboardingStatusRevisionStates.Approved;
}

/** Build an owner-visible result from exact revision evidence. */
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

/** Map a generated Prisma colour into the persona-owned API vocabulary. */
function _PersonaColour(value: PersonaColour): PersonaColourValues
{
	return { [PersonaColour.Red]: PersonaColourValues.Red, [PersonaColour.Yellow]: PersonaColourValues.Yellow, [PersonaColour.Green]: PersonaColourValues.Green, [PersonaColour.Blue]: PersonaColourValues.Blue }[value];
}

/** Map a generated Prisma modifier into the persona-owned API vocabulary. */
function _PersonaModifier(value: PersonaOpennessModifier): PersonaModifierValues
{
	return { [PersonaOpennessModifier.Explorer]: PersonaModifierValues.Explorer, [PersonaOpennessModifier.Guardian]: PersonaModifierValues.Guardian }[value];
}
