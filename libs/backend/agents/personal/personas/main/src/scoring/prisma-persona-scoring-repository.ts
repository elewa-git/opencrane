import { PersonaColour, PersonaOpennessModifier, PersonaTieKind, Prisma } from "@prisma/client";

import { _ScorePersona } from "./persona-scorer.js";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaAuthoritativeScoreResult, type PersonaTieChoice, type PersonaWeightedAnswer } from "./persona-scorer.types.js";
import { PersonaScoringPersistenceStatuses, type PersonaScoringEvidence, type PersonaScoringPersistenceResult, type PersonaScoringRepository, type ResolvePersonaTieCommand, type StoredPersonaScore } from "./persona-scoring-repository.types.js";

/** Prisma adapter for immutable score vectors and append-only tie choices. */
export class PrismaPersonaScoringRepository implements PersonaScoringRepository
{
	/** Transaction-scoped ORM capability. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind scoring reads and writes to one persona transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Create the immutable raw score after completion, or replay its exact derivation. */
	async ensureScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>
	{
		const evidence = await this._evidence(interviewId, personaProfileId, userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		const score = _ScorePersona(evidence.answers, evidence.resolutions);
		if (score === null) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		const existing = await this.transaction.personaInterviewScore.findUnique({ where: { interviewId }, select: { scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicyDigest: true, orderedAnswerIds: true, orderedChoiceIds: true, red: true, yellow: true, green: true, blue: true, colourTotal: true, explorer: true, guardian: true, opennessTotal: true, primaryCandidates: true } });
		if (existing !== null && !_StoredScoreMatches(evidence, score, existing)) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		if (existing === null)
		{
			await this.transaction.personaInterviewScore.create({ data: {
				interviewId,
				scoringPolicyId: evidence.scoringPolicyId,
				scoringPolicyVersion: evidence.scoringPolicyVersion,
				scoringPolicyDigest: evidence.scoringPolicyDigest,
				orderedAnswerIds: [...score.orderedAnswerIds],
				orderedChoiceIds: [...score.orderedChoiceIds],
				red: score.colours.red,
				yellow: score.colours.yellow,
				green: score.colours.green,
				blue: score.colours.blue,
				colourTotal: score.colours.total,
				explorer: score.openness.explorer,
				guardian: score.openness.guardian,
				opennessTotal: score.openness.total,
				primaryCandidates: score.candidateEvidence.primary.map(_ToPrismaColour),
				secondaryCandidates: score.candidateEvidence.secondary.map(_ToPrismaColour),
				modifierCandidates: score.candidateEvidence.modifier.map(_ToPrismaModifier),
			} });
		}
		return { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Replay a previously persisted immutable score without writing from a read or approval path. */
	async readScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>
	{
		const evidence = await this._evidence(interviewId, personaProfileId, userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		const score = _ScorePersona(evidence.answers, evidence.resolutions);
		if (score === null) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		const stored = await this.transaction.personaInterviewScore.findUnique({ where: { interviewId }, select: { scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicyDigest: true, orderedAnswerIds: true, orderedChoiceIds: true, red: true, yellow: true, green: true, blue: true, colourTotal: true, explorer: true, guardian: true, opennessTotal: true, primaryCandidates: true } });
		if (stored === null || !_StoredScoreMatches(evidence, score, stored)) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		return { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Append only the exact next tie choice and return the replayed result. */
	async resolveTie(command: ResolvePersonaTieCommand): Promise<PersonaScoringPersistenceResult>
	{
		const current = await this.ensureScore(command.interviewId, command.personaProfileId, command.userId);
		if (current.status !== PersonaScoringPersistenceStatuses.Ready) return current;
		const required = current.score.resolutionRequired;
		if (required === null || required.kind !== command.kind || !required.candidates.includes(command.selectedValue)) return { status: PersonaScoringPersistenceStatuses.InvalidResolution };
		const evidence = await this._evidence(command.interviewId, command.personaProfileId, command.userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		if (evidence.resolutions.some(function _SameKind(resolution) { return resolution.kind === command.kind; })) return { status: PersonaScoringPersistenceStatuses.AlreadyResolved };
		await this.transaction.personaTieResolution.create({ data: { interviewId: command.interviewId, scoringPolicyId: evidence.scoringPolicyId, scoringPolicyVersion: evidence.scoringPolicyVersion, kind: _ToPrismaTieKind(command.kind), candidates: [...required.candidates], selectedValue: command.selectedValue, resolvedBy: command.userId, resolvedAt: new Date(command.resolvedAt) } });
		const score = _ScorePersona(evidence.answers, [...evidence.resolutions, { kind: command.kind, candidates: required.candidates, selectedValue: command.selectedValue }]);
		return score === null ? { status: PersonaScoringPersistenceStatuses.InvalidEvidence } : { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Read the exact completed interview, weights, and resolutions from one snapshot. */
	private async _evidence(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringEvidence | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: interviewId, personaProfileId, userId, state: "Completed" }, select: { scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicy: { select: { digest: true } } } });
		if (interview === null) return null;
		const answers = await this.transaction.personaInterviewAnswer.findMany({ where: { interviewId }, select: { id: true, questionId: true, choiceId: true, choice: { select: { question: { select: { ordinal: true } }, weights: { where: { scoringPolicyId: interview.scoringPolicyId, scoringPolicyVersion: interview.scoringPolicyVersion }, select: { red: true, yellow: true, green: true, blue: true, explorer: true, guardian: true } } } } }, orderBy: { questionId: "asc" } });
		const weighted: PersonaWeightedAnswer[] = [];
		for (const answer of answers.sort(function _Ordinal(left, right) { return left.choice.question.ordinal - right.choice.question.ordinal; }))
		{
			const weight = answer.choice.weights[0];
			if (weight === undefined || answer.choice.weights.length !== 1) return null;
			weighted.push({ answerId: answer.id, questionId: answer.questionId, choiceId: answer.choiceId, ...weight });
		}
		const rows = await this.transaction.personaTieResolution.findMany({ where: { interviewId }, select: { kind: true, candidates: true, selectedValue: true }, orderBy: { resolvedAt: "asc" } });
		return { scoringPolicyId: interview.scoringPolicyId, scoringPolicyVersion: interview.scoringPolicyVersion, scoringPolicyDigest: interview.scoringPolicy.digest, answers: weighted, resolutions: rows.map(function _Resolution(row): PersonaTieChoice { return { kind: _FromPrismaTieKind(row.kind), candidates: row.candidates, selectedValue: row.selectedValue }; }) };
	}
}

/** Require an existing immutable row to match a replayed policy, answer order, and raw vector. */
function _StoredScoreMatches(evidence: PersonaScoringEvidence, score: PersonaAuthoritativeScoreResult, stored: StoredPersonaScore): boolean
{
	return stored.scoringPolicyId === evidence.scoringPolicyId
		&& stored.scoringPolicyVersion === evidence.scoringPolicyVersion
		&& stored.scoringPolicyDigest === evidence.scoringPolicyDigest
		&& _SameStrings(stored.orderedAnswerIds, score.orderedAnswerIds)
		&& _SameStrings(stored.orderedChoiceIds, score.orderedChoiceIds)
		&& stored.red === score.colours.red && stored.yellow === score.colours.yellow
		&& stored.green === score.colours.green && stored.blue === score.colours.blue
		&& stored.colourTotal === score.colours.total
		&& stored.explorer === score.openness.explorer && stored.guardian === score.openness.guardian
		&& stored.opennessTotal === score.openness.total
		&& _SameStrings(stored.primaryCandidates, score.candidateEvidence.primary.map(_ToPrismaColour));
}

/** Compare one ordered immutable string or string-enum vector. */
function _SameStrings(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}

/** Convert a wire colour to the Prisma enum. */
function _ToPrismaColour(value: PersonaColourValues): PersonaColour
{
	const match = { red: PersonaColour.Red, yellow: PersonaColour.Yellow, green: PersonaColour.Green, blue: PersonaColour.Blue }[value];
	if (match === undefined) throw new Error("invalid persona colour");
	return match;
}

/** Convert a wire modifier to the Prisma enum. */
function _ToPrismaModifier(value: PersonaModifierValues): PersonaOpennessModifier
{
	const match = { explorer: PersonaOpennessModifier.Explorer, guardian: PersonaOpennessModifier.Guardian }[value];
	if (match === undefined) throw new Error("invalid persona modifier");
	return match;
}

/** Convert a governed tie boundary to the Prisma enum. */
function _ToPrismaTieKind(value: PersonaTieKinds): PersonaTieKind
{
	return { [PersonaTieKinds.Primary]: PersonaTieKind.Primary, [PersonaTieKinds.Secondary]: PersonaTieKind.Secondary, [PersonaTieKinds.Modifier]: PersonaTieKind.Modifier }[value];
}

/** Convert a Prisma tie boundary to the public domain enum. */
function _FromPrismaTieKind(value: PersonaTieKind): PersonaTieKinds
{
	return { [PersonaTieKind.Primary]: PersonaTieKinds.Primary, [PersonaTieKind.Secondary]: PersonaTieKinds.Secondary, [PersonaTieKind.Modifier]: PersonaTieKinds.Modifier }[value];
}
