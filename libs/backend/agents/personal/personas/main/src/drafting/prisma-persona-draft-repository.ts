import { PersonaColour, PersonaOpennessModifier, Prisma } from "@prisma/client";

import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";
import type { PersonaProfileRecord } from "../profile/persona-aggregate-read-repository.types.js";
import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import { PersonaColourValues, PersonaModifierValues, type PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";

import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftPersistenceResult, type PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types.js";
import { _DerivePersonaDraftSources } from "./persona-draft-source-deriver.js";
import type { PersonaDraftInsightEvidence } from "./persona-draft-persistence.types.js";

/** Prisma authority that compiles one reviewed weighted result into an immutable draft. */
export class PrismaPersonaDraftRepository implements PersonaDraftFromInterviewRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Aggregate evidence reads shared with lifecycle mutation fences. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Domain-owned weighted scoring and tie replay. */
	private readonly scoring: PrismaPersonaScoringRepository;

	/** Create the draft authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
		this.scoring = new PrismaPersonaScoringRepository(this.transaction);
	}

	/** Read exact reviewed sources and persist one reviewable persona revision. */
	async createFromInterviewAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		// 1. Rebind owner and completed interview inside this serializable snapshot.
		const profile = await this.reads.readProfile(command);
		if (profile === null) return { status: PersonaDraftDenialReasons.NotFoundOrWrongOwner };
		const interview = await this._interview(command);
		if (interview === null) return { status: PersonaDraftDenialReasons.InterviewIncomplete };

		// 2. Replay the immutable score and reject every unresolved tie before template selection.
		const scored = await this.scoring.readScore(command.interviewId, command.personaProfileId, command.userId);
		if (scored.status !== PersonaScoringPersistenceStatuses.Ready) return { status: PersonaDraftDenialReasons.DerivationMismatch };
		const resolvedScore = _ResolvedScore(scored.score);
		if (resolvedScore === null) return { status: PersonaDraftDenialReasons.ResolutionRequired };

		// 3. Compile only reviewed choice directives into the exact colour/modifier template.
		const sources = await this._sources(interview, resolvedScore);
		if (sources === null) return { status: PersonaDraftDenialReasons.DerivationMismatch };
		if (sources.insights.length < 3 || sources.insights.length > 5) return { status: PersonaDraftDenialReasons.InvalidInsights };

		// 4. Pin every reviewed source and raw vector when allocating the next immutable revision.
		return this._persist(command, profile, interview, resolvedScore, sources);
	}

	/** Read the exact completed interview sources and ordered choice evidence. */
	private async _interview(command: CreatePersonaDraftCommand): Promise<PersonaDraftInterview | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: "Completed" }, select: { questionSetId: true, questionSetVersion: true, scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicy: { select: { digest: true } }, interpolationMapId: true, interpolationMapVersion: true, interpolationMap: { select: { digest: true, directives: true } }, answers: { select: { id: true, questionId: true, choiceId: true, choice: { select: { label: true, question: { select: { category: true } } } } }, orderBy: { questionId: "asc" } } } });
		return interview;
	}

	/** Select one reviewed template, interpolation set, and four provenance insights. */
	private async _sources(interview: PersonaDraftInterview, score: PersonaResolvedScore): Promise<PersonaDraftSources | null>
	{
		const template = await this.transaction.personaSoulTemplate.findUnique({ where: { primaryColour_modifier_version: { primaryColour: _ToPrismaColour(score.primary), modifier: _ToPrismaModifier(score.modifier), version: interview.scoringPolicyVersion } }, select: { id: true, version: true, digest: true, content: true } });
		if (template === null) return null;
		const derived = _DerivePersonaDraftSources({
			questionSetId: interview.questionSetId,
			questionSetVersion: interview.questionSetVersion,
			templateContent: template.content,
			interpolationDirectives: interview.interpolationMap.directives,
			secondaryColour: score.secondary,
			answers: interview.answers.map(function _Answer(answer) { return { answerId: answer.id, questionId: answer.questionId, choiceId: answer.choiceId, choiceLabel: answer.choice.label, category: answer.choice.question.category }; }),
		});
		return derived === null ? null : { template, ...derived };
	}

	/** Persist the draft revision and its bounded insight evidence. */
	private async _persist(command: CreatePersonaDraftCommand, profile: PersonaProfileRecord, interview: PersonaDraftInterview, score: PersonaResolvedScore, sources: PersonaDraftSources): Promise<CreatePersonaDraftPersistenceResult>
	{
		const revisionNumber = await this.reads.readNextRevision(command.personaProfileId);
		const revision = await this.transaction.personaRevision.create({ data: { personaProfileId: command.personaProfileId, revision: revisionNumber, soulTemplateId: sources.template.id, soulTemplateVersion: sources.template.version, soulTemplateDigest: sources.template.digest, interviewId: command.interviewId, scoringPolicyId: interview.scoringPolicyId, scoringPolicyVersion: interview.scoringPolicyVersion, scoringPolicyDigest: interview.scoringPolicy.digest, interpolationMapId: interview.interpolationMapId, interpolationMapVersion: interview.interpolationMapVersion, interpolationMapDigest: interview.interpolationMap.digest, scoringEvidence: _ScoringJson(score), primaryColour: _ToPrismaColour(score.primary), secondaryColour: _ToPrismaColour(score.secondary), modifier: _ToPrismaModifier(score.modifier), compiledInstructions: sources.compiledInstructions, previousRevisionId: profile.activeRevisionId, authoredBy: command.userId, createdAt: new Date(command.authoredAt) }, select: { id: true } });
		await this.transaction.personaInsight.createMany({ data: sources.insights.map(function _Insight(insight) { return { personaRevisionId: revision.id, category: insight.category, statement: insight.statement, interviewId: command.interviewId, questionSetId: insight.questionSetId, questionSetVersion: insight.questionSetVersion, questionId: insight.questionId, answerId: insight.answerId }; }) });
		return { status: PersonaLifecycleOutcomes.Created, personaRevisionId: revision.id };
	}
}

/** Completed interview source shape read for deterministic draft compilation. */
interface PersonaDraftInterview
{
	/** Reviewed question-set identity. */
	readonly questionSetId: string;
	/** Reviewed question-set version. */
	readonly questionSetVersion: number;
	/** Reviewed scoring-policy identity. */
	readonly scoringPolicyId: string;
	/** Reviewed scoring-policy version. */
	readonly scoringPolicyVersion: number;
	/** Reviewed scoring-policy digest. */
	readonly scoringPolicy: { readonly digest: string };
	/** Reviewed interpolation-map identity. */
	readonly interpolationMapId: string;
	/** Reviewed interpolation-map version. */
	readonly interpolationMapVersion: number;
	/** Reviewed interpolation-map source. */
	readonly interpolationMap: { readonly digest: string; readonly directives: Prisma.JsonValue };
	/** Ordered exact answer choices. */
	readonly answers: readonly { readonly id: string; readonly questionId: string; readonly choiceId: string; readonly choice: { readonly label: string; readonly question: { readonly category: Prisma.PersonaInsightCreateManyInput["category"] } } }[];
}

/** Fully resolved score type admitted to draft compilation. */
type PersonaResolvedScore = PersonaScoreResult & { readonly primary: PersonaColourValues; readonly secondary: PersonaColourValues; readonly modifier: PersonaModifierValues; readonly resolutionRequired: null };

/** Sources required to compile and review one draft. */
interface PersonaDraftSources
{
	/** Exact selected SOUL template. */
	readonly template: { readonly id: string; readonly version: number; readonly digest: string; readonly content: string };
	/** Exact immutable runtime instructions compiled from reviewed sources. */
	readonly compiledInstructions: string;
	/** Four provenance-linked result insights. */
	readonly insights: readonly PersonaDraftInsightEvidence<Prisma.PersonaInsightCreateManyInput["category"]>[];
}

/** Narrow a score only after every governed tie boundary is resolved. */
function _ResolvedScore(score: PersonaScoreResult): PersonaResolvedScore | null
{
	return score.resolutionRequired === null && score.primary !== null && score.secondary !== null && score.modifier !== null ? score as PersonaResolvedScore : null;
}

/** Serialize the lossless score without presentation percentages. */
function _ScoringJson(score: PersonaScoreResult): Prisma.InputJsonObject
{
	return { orderedAnswerIds: [...score.orderedAnswerIds], orderedChoiceIds: [...score.orderedChoiceIds], colours: { ...score.colours }, openness: { ...score.openness }, tieResolutions: score.tieResolutions.map(function _Resolution(resolution) { return { kind: resolution.kind, candidates: [...resolution.candidates], selectedValue: resolution.selectedValue }; }), primary: score.primary, secondary: score.secondary, modifier: score.modifier };
}

/** Convert one domain colour to its database enum. */
function _ToPrismaColour(value: PersonaColourValues): PersonaColour
{
	return { [PersonaColourValues.Red]: PersonaColour.Red, [PersonaColourValues.Yellow]: PersonaColour.Yellow, [PersonaColourValues.Green]: PersonaColour.Green, [PersonaColourValues.Blue]: PersonaColour.Blue }[value];
}

/** Convert one domain modifier to its database enum. */
function _ToPrismaModifier(value: PersonaModifierValues): PersonaOpennessModifier
{
	return { [PersonaModifierValues.Explorer]: PersonaOpennessModifier.Explorer, [PersonaModifierValues.Guardian]: PersonaOpennessModifier.Guardian }[value];
}
