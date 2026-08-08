import { PersonaInterviewState, PersonaRevisionState, Prisma } from "@prisma/client";

import { PrismaPersonalConfigurationPersonaRefreshRepository } from "@opencrane/backend/agents/personal/configuration";

import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import { PersonaScoringPersistenceStatuses } from "../scoring/persona-scoring-repository.types.js";
import { PrismaPersonaScoringRepository } from "../scoring/prisma-persona-scoring-repository.js";
import { PersonaColourValues, PersonaModifierValues } from "../scoring/persona-scorer.types.js";
import { PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type AtomicApprovePersonaCommand, type AtomicApprovePersonaResult, type PersonaApprovalSnapshot, type PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Prisma-backed authority that atomically approves and activates one personal persona revision. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Transaction-scoped canonical product database. */
	private readonly transaction: Prisma.TransactionClient;
	/** Configuration-owned proposal repository bound to the same transaction. */
	private readonly refreshes: PrismaPersonalConfigurationPersonaRefreshRepository;
	/** Aggregate-owned profile and revision evidence reads used by the approval mutation fence. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Weighted scoring replay bound to this approval snapshot. */
	private readonly scoring: PrismaPersonaScoringRepository;

	/** Create the authority over one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.refreshes = new PrismaPersonalConfigurationPersonaRefreshRepository(this.transaction);
		this.reads = new PrismaPersonaAggregateReadRepository(this.transaction);
		this.scoring = new PrismaPersonaScoringRepository(this.transaction);
	}

	/** Load the exact approval evidence required before an owner may activate a persona draft. */
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

		// The target-baseline trigger remains the commit authority; this query gives callers a precise preflight denial.
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

	/** Approve a still-valid draft and move its profile pointer inside one serializable transaction. */
	async approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>
	{
		// 1. Read the profile; serializable isolation turns two drafts racing to become active into a conflict.
		const profile = await this.reads.readProfileForOwner(command);
		if (profile === null) return { status: PersonaApprovalPersistenceStatuses.NotFound };
		// 2. Read the draft revision before inspecting its evidence; the state filter rebinds the reviewed snapshot.
		const revision = await this.reads.readDraftRevision(command);
		if (revision === null) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		const interview = await this.transaction.personaInterview.findUnique({ where: { id: revision.interviewId }, select: { refreshConfigurationChangeId: true } });
		if (interview === null) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 3. Rebind the exact evidence count accepted at preflight; a valid extra insight still changes the reviewed draft.
		const insightCount = await this.transaction.personaInsight.count({ where: { personaRevisionId: command.personaRevisionId } });
		if (insightCount !== command.expectedInsightCount) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 4. The baseline trigger rechecks interview, template, and insight evidence at this mutation fence.
		const approvedRevision = await this.transaction.personaRevision.updateMany({ where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft }, data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) } });
		if (approvedRevision.count !== 1) return { status: PersonaApprovalPersistenceStatuses.Conflict };
		// 5. Point the same locked profile at the newly approved revision; its trigger rejects an invalid target.
		const activatedProfile = await this.transaction.personaProfile.updateMany({ where: { id: command.personaProfileId, userId: command.userId }, data: { activeRevisionId: command.personaRevisionId } });
		if (activatedProfile.count !== 1) throw new PersonaApprovalTransactionConflict();
		// 6. Apply only the refresh proposal that the completed interview carries; unrelated accepted proposals remain pending.
		if (interview.refreshConfigurationChangeId === null) return { status: PersonaApprovalPersistenceStatuses.Approved };
		const applied = await this.refreshes.applyApprovedPersonaRefresh({ configurationChangeId: interview.refreshConfigurationChangeId, siloId: profile.siloId, userId: command.userId, personaProfileId: command.personaProfileId, personaRevisionId: command.personaRevisionId });
		if (!applied) throw new PersonaApprovalTransactionConflict();
		return { status: PersonaApprovalPersistenceStatuses.Approved };
	}
}

/** Convert the Prisma colour enum without allowing a fallback. */
function _PrismaColour(value: "Red" | "Yellow" | "Green" | "Blue"): PersonaColourValues
{
	return { Red: PersonaColourValues.Red, Yellow: PersonaColourValues.Yellow, Green: PersonaColourValues.Green, Blue: PersonaColourValues.Blue }[value];
}

/** Convert the Prisma modifier enum without allowing a fallback. */
function _PrismaModifier(value: "Explorer" | "Guardian"): PersonaModifierValues
{
	return { Explorer: PersonaModifierValues.Explorer, Guardian: PersonaModifierValues.Guardian }[value];
}

/** Canonicalize JSON objects for a strict replay comparison. */
function _StableJson(value: unknown): string
{
	if (Array.isArray(value)) return `[${value.map(_StableJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(function _Key(left, right) { return left[0].localeCompare(right[0]); }).map(function _Entry(entry) { return `${JSON.stringify(entry[0])}:${_StableJson(entry[1])}`; }).join(",")}}`;
	return JSON.stringify(value);
}

/** Abort a transaction after an approval mutation when a later required mutation cannot commit. */
export class PersonaApprovalTransactionConflict extends Error
{
}

/** Convert Prisma's closed interview enum into the domain approval vocabulary. */
function _asInterviewState(state: PersonaInterviewState): PersonaApprovalInterviewStates
{
	if (state === PersonaInterviewState.Completed) return PersonaApprovalInterviewStates.Completed;
	return PersonaApprovalInterviewStates.InProgress;
}
