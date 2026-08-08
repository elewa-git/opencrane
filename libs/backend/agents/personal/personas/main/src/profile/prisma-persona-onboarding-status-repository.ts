import { PersonaInterviewState, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";
import type { PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";
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
		if (profile === null) return _EmptyStatus();
		const interview = profile.interviews[0];
		if (interview === undefined) return profile.activeRevisionId === null ? _EmptyStatus() : { ..._EmptyStatus(), state: PersonaOnboardingApiStates.Ready, personaRevisionId: profile.activeRevisionId };
		const selected = new Map(interview.answers.map(function _Answer(answer) { return [answer.questionId, answer.choiceId]; }));
		const questions: readonly PersonaStatusQuestion[] = interview.questionSet.questions.map(function _Question(question) { return { ...question, selectedChoiceId: selected.get(question.id) ?? null }; });
		const revision = await this.transaction.personaRevision.findFirst({ where: { personaProfileId: profile.id, interviewId: interview.id }, orderBy: { revision: "desc" }, select: { id: true, state: true, primaryColour: true, secondaryColour: true, modifier: true, compiledInstructions: true, soulTemplate: { select: { displayName: true } }, scoringEvidence: true, insights: { select: { statement: true }, orderBy: { id: "asc" } } } });
		if (revision !== null)
		{
			return { state: revision.state === PersonaRevisionState.Draft ? PersonaOnboardingApiStates.Review : PersonaOnboardingApiStates.Ready, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: questions.length, personaRevisionId: revision.id, questions, resolution: null, result: _RevisionResult(revision) };
		}
		if (interview.state === PersonaInterviewState.InProgress) return { state: PersonaOnboardingApiStates.Interview, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: questions.length, personaRevisionId: null, questions, resolution: null, result: null };
		const scored = await this.scoring.readScore(interview.id, profile.id, userId);
		if (scored.status !== PersonaScoringPersistenceStatuses.Ready) return { state: PersonaOnboardingApiStates.Interview, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: questions.length, personaRevisionId: null, questions, resolution: null, result: null };
		return { state: scored.score.resolutionRequired === null ? PersonaOnboardingApiStates.Review : PersonaOnboardingApiStates.Resolution, interviewId: interview.id, answeredQuestionCount: interview.answers.length, questionCount: questions.length, personaRevisionId: null, questions, resolution: scored.score.resolutionRequired, result: _ScoreResult(scored.score) };
	}
}

/** Return the bounded initial status before a profile or interview exists. */
function _EmptyStatus(): PersonaOnboardingStatus
{
	return { state: PersonaOnboardingApiStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null, questions: [], resolution: null, result: null };
}

/** Build an owner-visible result from exact revision evidence. */
function _RevisionResult(revision: { readonly primaryColour: string; readonly secondaryColour: string; readonly modifier: string; readonly compiledInstructions: string; readonly soulTemplate: { readonly displayName: string }; readonly scoringEvidence: Prisma.JsonValue; readonly insights: readonly { readonly statement: string }[] }): PersonaStatusResult
{
	const evidence = revision.scoringEvidence as unknown as { readonly colours: PersonaScoreResult["colours"]; readonly openness: PersonaScoreResult["openness"] };
	return { displayName: revision.soulTemplate.displayName, primaryColour: revision.primaryColour.toLowerCase(), secondaryColour: revision.secondaryColour.toLowerCase(), modifier: revision.modifier.toLowerCase(), colourScores: evidence.colours, opennessScores: evidence.openness, insights: revision.insights.map(function _Insight(insight) { return insight.statement; }), instructionPreview: revision.compiledInstructions };
}

/** Build a pre-draft result once every scoring boundary is resolved. */
function _ScoreResult(score: PersonaScoreResult): PersonaStatusResult | null
{
	if (score.primary === null || score.secondary === null || score.modifier === null) return null;
	return { displayName: "Persona result", primaryColour: score.primary, secondaryColour: score.secondary, modifier: score.modifier, colourScores: score.colours, opennessScores: score.openness, insights: [], instructionPreview: null };
}
