import { PersonaColour, PersonaOpennessModifier, PersonaTieKind, Prisma } from "@prisma/client";

import { _ScorePersona } from "./persona-scorer.js";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaAuthoritativeScoreResult, type PersonaSelectionValue, type PersonaTieChoice, type PersonaWeightedAnswer } from "./persona-scorer.types.js";
import { PersonaScoringPersistenceStatuses, type PersonaScoringEvidence, type PersonaScoringPersistenceResult, type PersonaScoringRepository, type ResolvePersonaTieCommand, type StoredPersonaScore } from "./persona-scoring-repository.types.js";

/** Prisma adapter that stores persona score counters and the owner's tie choices. */
export class PrismaPersonaScoringRepository implements PersonaScoringRepository
{
	/** Prisma client for the caller's transaction; every read and write here uses it. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind scoring reads and writes to one persona transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Writes the score row the first time. On later calls it recomputes the score and refuses if the stored row no longer matches. */
	async ensureScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>
	{
		const evidence = await this._evidence(interviewId, personaProfileId, userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		const score = _ScorePersona(evidence.answers, evidence.resolutions);
		const initialScore = _ScorePersona(evidence.answers, []);
		if (score === null || initialScore === null) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		const existing = await this.transaction.personaInterviewScore.findUnique({ where: { interviewId }, select: { scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicyDigest: true, orderedAnswerIds: true, orderedChoiceIds: true, red: true, yellow: true, green: true, blue: true, colourTotal: true, explorer: true, guardian: true, opennessTotal: true, primaryCandidates: true, secondaryCandidates: true, modifierCandidates: true } });
		if (existing !== null && !_StoredScoreMatches(evidence, score, initialScore.candidateEvidence, existing)) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
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
				primaryCandidates: initialScore.candidateEvidence.primary.map(_ToPrismaColour),
				secondaryCandidates: initialScore.candidateEvidence.secondary.map(_ToPrismaColour),
				modifierCandidates: initialScore.candidateEvidence.modifier.map(_ToPrismaModifier),
			} });
		}
		return { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Recomputes a stored score and checks it matches. Never writes, so the read and approval paths can call it. */
	async readScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>
	{
		const evidence = await this._evidence(interviewId, personaProfileId, userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		const score = _ScorePersona(evidence.answers, evidence.resolutions);
		const initialScore = _ScorePersona(evidence.answers, []);
		if (score === null || initialScore === null) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		const stored = await this.transaction.personaInterviewScore.findUnique({ where: { interviewId }, select: { scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicyDigest: true, orderedAnswerIds: true, orderedChoiceIds: true, red: true, yellow: true, green: true, blue: true, colourTotal: true, explorer: true, guardian: true, opennessTotal: true, primaryCandidates: true, secondaryCandidates: true, modifierCandidates: true } });
		if (stored === null || !_StoredScoreMatches(evidence, score, initialScore.candidateEvidence, stored)) return { status: PersonaScoringPersistenceStatuses.InvalidEvidence };
		return { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Records the owner's choice for the tie the score is waiting on, then returns the recomputed score. */
	async resolveTie(command: ResolvePersonaTieCommand): Promise<PersonaScoringPersistenceResult>
	{
		const current = await this.ensureScore(command.interviewId, command.personaProfileId, command.userId);
		if (current.status !== PersonaScoringPersistenceStatuses.Ready) return current;
		const required = current.score.resolutionRequired;
		if (required === null || required.kind !== command.kind || !_IsSelectionValue(command.selectedValue) || !required.candidates.includes(command.selectedValue)) return { status: PersonaScoringPersistenceStatuses.InvalidResolution };
		const evidence = await this._evidence(command.interviewId, command.personaProfileId, command.userId);
		if (evidence === null) return { status: PersonaScoringPersistenceStatuses.NotFound };
		if (evidence.resolutions.some(function _SameKind(resolution) { return resolution.kind === command.kind; })) return { status: PersonaScoringPersistenceStatuses.AlreadyResolved };
		await this.transaction.personaTieResolution.create({ data: { interviewId: command.interviewId, scoringPolicyId: evidence.scoringPolicyId, scoringPolicyVersion: evidence.scoringPolicyVersion, kind: _ToPrismaTieKind(command.kind), candidates: [...required.candidates], selectedValue: command.selectedValue, resolvedBy: command.userId, resolvedAt: new Date(command.resolvedAt) } });
		const score = _ScorePersona(evidence.answers, [...evidence.resolutions, { kind: command.kind, candidates: required.candidates, selectedValue: command.selectedValue }]);
		return score === null ? { status: PersonaScoringPersistenceStatuses.InvalidEvidence } : { status: PersonaScoringPersistenceStatuses.Ready, score };
	}

	/** Reads the completed interview, its weighted answers, and its tie choices in one pass. Returns null when anything is missing or a choice has more than one weight. */
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
		const resolutions: PersonaTieChoice[] = [];
		for (const row of rows)
		{
			const resolution = _StoredTieChoice(row);
			if (resolution === null) return null;
			resolutions.push(resolution);
		}
		return { scoringPolicyId: interview.scoringPolicyId, scoringPolicyVersion: interview.scoringPolicyVersion, scoringPolicyDigest: interview.scoringPolicy.digest, answers: weighted, resolutions };
	}
}

/** Returns whether the stored score row still matches a freshly computed score: same policy, same answer order, same counters, same first-pass candidates. */
function _StoredScoreMatches(evidence: PersonaScoringEvidence, score: PersonaAuthoritativeScoreResult, initialCandidates: PersonaAuthoritativeScoreResult["candidateEvidence"], stored: StoredPersonaScore): boolean
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
		&& _SameStrings(stored.primaryCandidates, initialCandidates.primary.map(_ToPrismaColour))
		&& _SameStrings(stored.secondaryCandidates, initialCandidates.secondary.map(_ToPrismaColour))
		&& _SameStrings(stored.modifierCandidates, initialCandidates.modifier.map(_ToPrismaModifier));
}

/** Returns whether two string lists match in value and order. */
function _SameStrings(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index) { return value === right[index]; });
}

/** Converts a domain colour value to its Prisma enum. */
function _ToPrismaColour(value: PersonaColourValues): PersonaColour
{
	const match = { red: PersonaColour.Red, yellow: PersonaColour.Yellow, green: PersonaColour.Green, blue: PersonaColour.Blue }[value];
	if (match === undefined) throw new Error("invalid persona colour");
	return match;
}

/** Converts a domain modifier value to its Prisma enum. */
function _ToPrismaModifier(value: PersonaModifierValues): PersonaOpennessModifier
{
	const match = { explorer: PersonaOpennessModifier.Explorer, guardian: PersonaOpennessModifier.Guardian }[value];
	if (match === undefined) throw new Error("invalid persona modifier");
	return match;
}

/** Converts a tie kind to its Prisma enum. */
function _ToPrismaTieKind(value: PersonaTieKinds): PersonaTieKind
{
	return { [PersonaTieKinds.Primary]: PersonaTieKind.Primary, [PersonaTieKinds.Secondary]: PersonaTieKind.Secondary, [PersonaTieKinds.Modifier]: PersonaTieKind.Modifier }[value];
}

/** Convert a Prisma tie boundary to the public domain enum. */
function _FromPrismaTieKind(value: PersonaTieKind): PersonaTieKinds
{
	return { [PersonaTieKind.Primary]: PersonaTieKinds.Primary, [PersonaTieKind.Secondary]: PersonaTieKinds.Secondary, [PersonaTieKind.Modifier]: PersonaTieKinds.Modifier }[value];
}

/** Turns one stored tie row into a domain tie choice, or null when a candidate is unknown or the row mixes colours with modifiers. */
function _StoredTieChoice(row: { readonly kind: PersonaTieKind; readonly candidates: readonly string[]; readonly selectedValue: string }): PersonaTieChoice | null
{
	const kind = _FromPrismaTieKind(row.kind);
	const candidates = row.candidates.filter(_IsSelectionValue);
	if (candidates.length !== row.candidates.length || !_IsSelectionValue(row.selectedValue)) return null;
	if (kind === PersonaTieKinds.Modifier && candidates.some(_IsColourValue)) return null;
	if (kind !== PersonaTieKinds.Modifier && candidates.some(_IsModifierValue)) return null;
	return { kind, candidates, selectedValue: row.selectedValue };
}

/** Returns whether a stored string is one of the colours or modifiers. */
function _IsSelectionValue(value: string): value is PersonaSelectionValue
{
	return _IsColourValue(value) || _IsModifierValue(value);
}

/** Returns whether a stored string is one of the four colours. */
function _IsColourValue(value: string): value is PersonaColourValues
{
	return Object.values(PersonaColourValues).some(function _Same(candidate) { return candidate === value; });
}

/** Returns whether a stored string is Explorer or Guardian. */
function _IsModifierValue(value: string): value is PersonaModifierValues
{
	return Object.values(PersonaModifierValues).some(function _Same(candidate) { return candidate === value; });
}
