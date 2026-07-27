import { AgentRevisionState, AgentServiceKind, PersonaRevisionState, Prisma, type PrismaClient } from "@prisma/client";

import { __CreatePersonalRevisionCloneData, _PERSONAL_REVISION_INCLUDE } from "./personal-revision-clone.js";
import type { ApprovePersonaRefreshCommand, PersonaRefreshApprovalRepository } from "./persona-refresh-interview.types.js";

/** Prisma authority that atomically approves a refresh persona and rolls the personal agent revision forward. */
export class PrismaPersonaRefreshApprovalRepository implements PersonaRefreshApprovalRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;

	/** Creates the refresh-approval authority over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Commits persona approval, active pointers, agent clone publication, and applied change evidence together. */
	async approveRefreshAtomically(command: ApprovePersonaRefreshCommand): Promise<{ readonly status: "approved"; readonly agentRevisionId: string } | { readonly status: "refresh_unavailable" | "approval_unavailable" | "conflict" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _approve(transaction)
			{
				// 1. Lock profile then draft and linked refresh change before any active pointer can move.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "refresh_unavailable" } as const;
				const draft = await transaction.personaRevision.findFirst({ where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft }, select: { id: true, interviewId: true } });
				if (draft === null) return { status: "approval_unavailable" } as const;
				const refreshes = await transaction.$queryRaw<readonly { readonly id: string; readonly agentServiceId: string; readonly expectedPersonaRevisionId: string | null; readonly expectedAgentRevisionId: string | null }[]>(Prisma.sql`SELECT change."id" AS "id", change."agent_service_id" AS "agentServiceId", change."expected_persona_revision_id" AS "expectedPersonaRevisionId", change."expected_agent_revision_id" AS "expectedAgentRevisionId" FROM "personal_configuration_changes" change JOIN "persona_interviews" interview ON interview."refresh_change_id" = change."id" WHERE interview."id" = ${draft.interviewId} AND change."silo_id" = ${command.siloId} AND change."user_id" = ${command.userId} AND change."persona_profile_id" = ${command.personaProfileId} AND change."state" = 'accepted'::"PersonalConfigurationChangeState" AND change."requested_patch" = '{"kind":"persona_refresh"}'::jsonb FOR UPDATE OF change, interview`);
				const refresh = refreshes[0];
				if (refresh === undefined) return { status: "refresh_unavailable" } as const;

				// 2. Lock the personal service and head, enforcing the strict original fence rather than an implicit rebase.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${refresh.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
				const profile = await transaction.personaProfile.findUnique({ where: { id: command.personaProfileId }, select: { activeRevisionId: true } });
				const service = await transaction.agentService.findFirst({ where: { id: refresh.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { id: true, activeRevisionId: true } });
				if (profile?.activeRevisionId !== refresh.expectedPersonaRevisionId || service === null || service.activeRevisionId === null || service.activeRevisionId !== refresh.expectedAgentRevisionId) return { status: "conflict" } as const;
				const head = await transaction.agentRevision.findFirst({ where: { id: service.activeRevisionId, agentServiceId: service.id }, include: _PERSONAL_REVISION_INCLUDE });
				if (head === null) return { status: "conflict" } as const;

				// 3. Approve the evidenced persona, publish its cloned agent revision, and seal the accepted change before commit.
				const approvedAt = new Date(command.approvedAt);
				await transaction.personaRevision.update({ where: { id: draft.id }, data: { state: PersonaRevisionState.Approved, approvedBy: command.userId, approvedAt } });
				await transaction.personaProfile.update({ where: { id: command.personaProfileId }, data: { activeRevisionId: draft.id } });
				const revision = await transaction.agentRevision.create({ data: __CreatePersonalRevisionCloneData(head, { modelDefinitionId: head.modelDefinitionId, personaRevisionId: draft.id, authoredBy: command.userId, changeMessage: "Accepted personal persona refresh", createdAt: approvedAt }), select: { id: true } });
				await transaction.agentRevision.update({ where: { id: revision.id }, data: { state: AgentRevisionState.Published, publishedAt: approvedAt } });
				await transaction.agentService.update({ where: { id: service.id }, data: { activeRevisionId: revision.id, updatedAt: approvedAt } });
				await transaction.personalConfigurationChange.update({ where: { id: refresh.id }, data: { state: "Applied", appliedPersonaRevisionId: draft.id, appliedAgentRevisionId: revision.id } });
				return { status: "approved", agentRevisionId: revision.id } as const;
			});
		}
		catch (error)
		{
			return error instanceof Prisma.PrismaClientKnownRequestError ? { status: "conflict" } : { status: "persistence_unavailable" };
		}
	}
}
