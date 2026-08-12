import { PersonaInterviewState, PersonaRevisionState, Prisma } from "@prisma/client";

import { PrismaPersonalConfigurationPersonaRefreshRepository } from "@opencrane/backend/agents/personal/configuration";

import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";
import { PersonaColourValues, PersonaModifierValues } from "../scoring/persona-scorer.types.js";
import { PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type AtomicApprovePersonaCommand, type AtomicApprovePersonaResult, type PersonaApprovalSnapshot, type PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Prisma adapter that approves one persona revision and makes it active in a single transaction. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Prisma client for the caller's transaction; every read and write here uses it. */
	private readonly transaction: Prisma.TransactionClient;
	/** Persona-refresh proposal repository, on the same transaction. */
	private readonly refreshes: PrismaPersonalConfigurationPersonaRefreshRepository;
	/** Shared reader for profile and revision rows; the approval update re-reads them through it just before writing. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Score repository used to recompute the score, on the same transaction. */
	private readonly scoring: PrismaPersonaScoringRepository;

	/** Create the authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.refreshes = new PrismaPersonalConfigurationPersonaRefreshRepository(this.transaction);
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
		this.scoring = new PrismaPersonaScoringRepository(this.transaction);
	}

	/** Reads everything approval must check before the owner can activate a draft. */
	async getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
	{
		const revision = await this.transaction.personaRevision.findFirst({
			where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId },
			select: {
				state: true,
				personaProfileId: true,
				soulTemplateDigest: true,
				durableSoulMutationPolicy: true,
				profile: { select: { userId: true, activeRevisionId: true } },
				interview: { select: { id: true, state: true, scoringPolicyId: true, scoringPolicyVersion: true, scoringPolicy: { select: { digest: true } }, interpolationMapId: true, interpolationMapVersion: true } },
				soulTemplate: { select: { digest: true, primaryColour: true, modifier: true } },
				_count: { select: { insights: true } },
				soulTemplateId: true,
				soulTemplateVersion: true,
				scoringPolicyId: true,
				scoringPolicyVersion: true,
				scoringPolicyDigest: true,
				interpolationMapId: true,
				interpolationMapVersion: true,
				interpolationMapDigest: true,
				primaryColour: true,
				secondaryColour: true,
				modifier: true,
				scoringEvidence: true,
				interpolationMap: { select: { digest: true } },
			},
		});
		if (revision === null) return null;

		// The database trigger persona_revisions_closed_lifecycle is what actually enforces this at commit; this query only lets the caller refuse early with a specific reason.
		const scored = await this.scoring.readScore(revision.interview.id, command.personaProfileId, command.userId);
		const templateSelectionMatches = scored.status === PersonaScoringPersistenceStatuses.Ready
			&& scored.score.resolutionRequired === null
			&& revision.scoringPolicyId === revision.interview.scoringPolicyId
			&& revision.scoringPolicyVersion === revision.interview.scoringPolicyVersion
			&& revision.scoringPolicyDigest === revision.interview.scoringPolicy.digest
			&& revision.interpolationMapId === revision.interview.interpolationMapId
			&& revision.interpolationMapVersion === revision.interview.interpolationMapVersion
			&& revision.interpolationMapDigest === revision.interpolationMap.digest
			&& _PrismaColour(revision.primaryColour) === scored.score.primary
			&& _PrismaColour(revision.secondaryColour) === scored.score.secondary
			&& _PrismaModifier(revision.modifier) === scored.score.modifier
			&& revision.soulTemplate.primaryColour === revision.primaryColour
			&& revision.soulTemplate.modifier === revision.modifier
			&& _StableJson(revision.scoringEvidence) === _StableJson({ orderedAnswerIds: scored.score.orderedAnswerIds, orderedChoiceIds: scored.score.orderedChoiceIds, colours: scored.score.colours, openness: scored.score.openness, tieResolutions: scored.score.tieResolutions, primary: scored.score.primary, secondary: scored.score.secondary, modifier: scored.score.modifier });
		return {
			profileUserId: revision.profile.userId,
			activeRevisionId: revision.profile.activeRevisionId,
			revisionState: revision.state === PersonaRevisionState.Draft ? PersonaApprovalRevisionStates.Draft : PersonaApprovalRevisionStates.Approved,
			revisionProfileId: revision.personaProfileId,
			interviewState: _asInterviewState(revision.interview.state),
			insightCount: revision._count.insights,
			templateDigestMatches: revision.soulTemplate.digest === revision.soulTemplateDigest,
			templateSelectionMatches,
			durableSoulMutationPolicy: revision.durableSoulMutationPolicy,
		};
	}

	/** Marks the draft approved and points the profile at it, both inside one Serializable transaction. */
	async approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>
	{
		// 1. Read the profile; serializable isolation turns two drafts racing to become active into a conflict.
		const profile = await this.reads.readProfileForOwner(command);
		if (profile === null) return { status: PersonaApprovalPersistenceStatuses.NotFound };
		// 2. Re-read the revision with a Draft filter, so a revision approved since the snapshot is no longer found.
		const revision = await this.reads.readDraftRevision(command);
		if (revision === null) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		const interview = await this.transaction.personaInterview.findUnique({ where: { id: revision.interviewId }, select: { refreshConfigurationChangeId: true } });
		if (interview === null) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 3. Re-count the insights. Even a valid extra insight means the owner reviewed a different draft, so refuse.
		const insightCount = await this.transaction.personaInsight.count({ where: { personaRevisionId: command.personaRevisionId } });
		if (insightCount !== command.expectedInsightCount) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 4. Flip the state to Approved. The persona_revisions_closed_lifecycle trigger rechecks the interview, template, and insight rules on this update.
		const approvedRevision = await this.transaction.personaRevision.updateMany({ where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft }, data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) } });
		if (approvedRevision.count !== 1) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 5. Point the profile at the newly approved revision. The enforce_active_persona_revision trigger rejects a target that is not an approved revision of this profile.
		const activatedProfile = await this.transaction.personaProfile.updateMany({ where: { id: command.personaProfileId, userId: command.userId }, data: { activeRevisionId: command.personaRevisionId } });
		if (activatedProfile.count !== 1) throw new PersonaApprovalTransactionConflict();
		// 6. Apply only the refresh proposal that the completed interview carries; unrelated accepted proposals remain pending.
		if (interview.refreshConfigurationChangeId === null) return { status: PersonaApprovalPersistenceStatuses.Approved };
		const applied = await this.refreshes.applyApprovedPersonaRefresh({ configurationChangeId: interview.refreshConfigurationChangeId, siloId: profile.siloId, userId: command.userId, personaProfileId: command.personaProfileId, personaRevisionId: command.personaRevisionId });
		if (!applied) throw new PersonaApprovalTransactionConflict();
		return { status: PersonaApprovalPersistenceStatuses.Approved };
	}
}

/** Converts a Prisma colour enum to the domain value. There is no default case, so a new enum value fails to compile. */
function _PrismaColour(value: "Red" | "Yellow" | "Green" | "Blue"): PersonaColourValues
{
	return { Red: PersonaColourValues.Red, Yellow: PersonaColourValues.Yellow, Green: PersonaColourValues.Green, Blue: PersonaColourValues.Blue }[value];
}

/** Converts a Prisma modifier enum to the domain value. There is no default case, so a new enum value fails to compile. */
function _PrismaModifier(value: "Explorer" | "Guardian"): PersonaModifierValues
{
	return { Explorer: PersonaModifierValues.Explorer, Guardian: PersonaModifierValues.Guardian }[value];
}

/**
 * Renders JSON with every object's keys sorted, so two documents can be compared as strings.
 *
 * This is a local sort-and-stringify, not the JSON Canonicalization Scheme: keys are ordered with
 * `localeCompare` rather than by UTF-16 code unit. Both sides of the comparison in
 * `getApprovalSnapshot` go through this same function, so the ordering only has to be self-consistent.
 * It is not safe to compare its output against JSON canonicalized anywhere else.
 */
function _StableJson(value: unknown): string
{
	if (Array.isArray(value)) return `[${value.map(_StableJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(function _Key(left, right) { return left[0].localeCompare(right[0]); }).map(function _Entry(entry) { return `${JSON.stringify(entry[0])}:${_StableJson(entry[1])}`; }).join(",")}}`;
	return JSON.stringify(value);
}

/**
 * Thrown to roll the approval transaction back when a write that must follow the approval update
 * cannot be made.
 *
 * By the time this is thrown the revision has already been marked approved inside the transaction, so
 * returning a status instead of throwing would commit a half-finished approval. Two cases raise it:
 * the profile row could not be pointed at the new revision, and the interview's bound refresh
 * proposal could not be applied.
 *
 * Thrown by: `PrismaPersonaAuthorityRepository.approveAndActivateAtomically`.
 * Caught by: `PrismaPersonaPersistenceUnitOfWork.approveAndActivateAtomically`, which converts it to
 * a `Conflict` status.
 *
 * @see PersonaApprovalPersistenceStatuses
 */
export class PersonaApprovalTransactionConflict extends Error
{
}

/** Converts a Prisma interview state into the value approval uses. */
function _asInterviewState(state: PersonaInterviewState): PersonaApprovalInterviewStates
{
	if (state === PersonaInterviewState.Completed) return PersonaApprovalInterviewStates.Completed;
	return PersonaApprovalInterviewStates.InProgress;
}
