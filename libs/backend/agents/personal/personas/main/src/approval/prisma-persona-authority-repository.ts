import { PersonaInterviewState, PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";

import type { PersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";

import type { PersonaDraftTemplateSelectorRepository } from "../drafting/persona-draft-template-selector.types.js";
import { PrismaPersonaAggregateReadRepository } from "../profile/prisma-persona-aggregate-read-repository.js";
import { PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type AtomicApprovePersonaCommand, type AtomicApprovePersonaResult, type PersonaApprovalSnapshot, type PersonaAuthorityRepository } from "./persona-authority.types.js";

/** Prisma-backed authority that atomically approves and activates one personal persona revision. */
export class PrismaPersonaAuthorityRepository implements PersonaAuthorityRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** Configuration-owned atomic boundary for a proposal-bound persona approval. */
	private readonly refreshes: PersonalConfigurationPersonaRefreshUnitOfWork;
	/** Aggregate-owned profile and revision evidence reads used by the approval mutation fence. */
	private readonly reads: PrismaPersonaAggregateReadRepository;
	/** Draft-owned deterministic selection reader shared by approval preflight. */
	private readonly templates: PersonaDraftTemplateSelectorRepository;

	/** Create the authority over the canonical product database. */
	constructor(prisma: PrismaClient, refreshes: PersonalConfigurationPersonaRefreshUnitOfWork, reads: PrismaPersonaAggregateReadRepository, templates: PersonaDraftTemplateSelectorRepository)
	{
		this.prisma = prisma;
		this.refreshes = refreshes;
		this.reads = reads;
		this.templates = templates;
	}

	/** Load the exact approval evidence required before an owner may activate a persona draft. */
	async getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
	{
		const revision = await this.prisma.personaRevision.findFirst({
			where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId },
			select: {
				state: true,
				personaProfileId: true,
				soulTemplateDigest: true,
				durableSoulMutationPolicy: true,
				profile: { select: { userId: true } },
				interview: { select: { id: true, state: true } },
				soulTemplate: { select: { digest: true } },
				_count: { select: { insights: true } },
				selectionRuleId: true,
				selectionAnswerIds: true,
				soulTemplateId: true,
				soulTemplateVersion: true,
			},
		});
		if (revision === null) return null;

		// The target-baseline trigger remains the commit authority; this query gives callers a precise preflight denial.
		const selected = await this.templates.select(this.prisma, revision.interview.id);
		const templateSelectionMatches = selected !== null
			&& revision.soulTemplateId === selected.templateId
			&& revision.soulTemplateVersion === selected.templateVersion
			&& revision.soulTemplateDigest === selected.templateDigest
			&& revision.selectionRuleId === selected.selectionRuleId
			&& [...revision.selectionAnswerIds].sort().every(function _sameAnswer(id, index) { return id === selected.selectionAnswerIds[index]; })
			&& revision.selectionAnswerIds.length === selected.selectionAnswerIds.length;
		return {
			profileUserId: revision.profile.userId,
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
		try
		{
			const reads = this.reads;
			return await this.refreshes.runPersonaRefresh(async function _approve(transaction, refreshes)
			{
				const client = transaction as Prisma.TransactionClient;
				// 1. Read the profile; serializable isolation turns two drafts racing to become active into a conflict.
				const profile = await reads.readProfileForOwner(client, command);
				if (profile === null) return { status: PersonaApprovalPersistenceStatuses.NotFound } as const;

				// 2. Read the draft revision before inspecting its evidence; the state filter rebinds the reviewed snapshot.
				const revision = await reads.readDraftRevision(client, command);
				if (revision === null) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;
				const interview = await client.personaInterview.findUnique({ where: { id: revision.interviewId }, select: { refreshConfigurationChangeId: true } });
				if (interview === null) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 3. Rebind the exact evidence count accepted at preflight; a valid extra insight still changes the reviewed draft.
				const insightCount = await client.personaInsight.count({ where: { personaRevisionId: command.personaRevisionId } });
				if (insightCount !== command.expectedInsightCount) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 4. The baseline trigger rechecks interview, template, and insight evidence at this mutation fence.
				const approvedRevision = await client.personaRevision.updateMany({
					where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft },
					data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt: new Date(command.approvedAt) },
				});
				if (approvedRevision.count !== 1) return { status: PersonaApprovalPersistenceStatuses.Conflict } as const;

				// 5. Point the same locked profile at the newly approved revision; its trigger rejects an invalid target.
				const activatedProfile = await client.personaProfile.updateMany({
					where: { id: command.personaProfileId, userId: command.userId },
					data: { activeRevisionId: command.personaRevisionId },
				});
				if (activatedProfile.count !== 1) throw new _PersonaApprovalConflict();

				// 6. Apply only the refresh proposal that the completed interview carries; unrelated accepted proposals remain pending.
				if (interview.refreshConfigurationChangeId === null) return { status: PersonaApprovalPersistenceStatuses.Approved } as const;
				const applied = await refreshes.applyApprovedPersonaRefresh({ configurationChangeId: interview.refreshConfigurationChangeId, siloId: profile.siloId, userId: command.userId, personaProfileId: command.personaProfileId, personaRevisionId: command.personaRevisionId });
				if (!applied) throw new _PersonaApprovalConflict();
				return { status: PersonaApprovalPersistenceStatuses.Approved } as const;
			});
		}
		catch (error)
		{
			if (error instanceof _PersonaApprovalConflict || error instanceof Prisma.PrismaClientKnownRequestError) return { status: PersonaApprovalPersistenceStatuses.Conflict };
			throw error;
		}
	}
}

/** Abort a transaction after an approval mutation when a later required mutation cannot commit. */
class _PersonaApprovalConflict extends Error
{
}

/** Convert Prisma's closed interview enum into the domain approval vocabulary. */
function _asInterviewState(state: PersonaInterviewState): PersonaApprovalInterviewStates
{
	if (state === PersonaInterviewState.Completed) return PersonaApprovalInterviewStates.Completed;
	return PersonaApprovalInterviewStates.InProgress;
}
