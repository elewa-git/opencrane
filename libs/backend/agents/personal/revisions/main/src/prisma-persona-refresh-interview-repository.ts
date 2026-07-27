import { Prisma, type PrismaClient } from "@prisma/client";
import { __StartPersonaInterviewWithinTransaction } from "@opencrane/backend/agents/personal/personas";

import type { PersonaRefreshInterviewRepository, StartPersonaRefreshInterviewCommand } from "./persona-refresh-interview.types.js";

/** Prisma authority that binds accepted refresh provenance to one actual persona interview. */
export class PrismaPersonaRefreshInterviewRepository implements PersonaRefreshInterviewRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;

	/** Creates the refresh-interview authority over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Starts one linked interview only when its accepted configuration fence is still current. */
	async startRefreshAtomically(command: StartPersonaRefreshInterviewCommand): Promise<{ readonly status: "started" | "already_started"; readonly interviewId: string } | { readonly status: "refresh_unavailable" | "interview_in_progress" | "question_set_unavailable" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _start(transaction)
			{
				// 1. Lock profile then service, matching configuration proposal, approval, and admission order.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "refresh_unavailable" } as const;
				const refreshes = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT change."id" FROM "personal_configuration_changes" change JOIN "agent_services" service ON service."id" = change."agent_service_id" JOIN "persona_profiles" profile ON profile."id" = change."persona_profile_id" WHERE change."id" = ${command.refreshChangeId} AND change."silo_id" = ${command.siloId} AND change."user_id" = ${command.userId} AND change."persona_profile_id" = ${command.personaProfileId} AND change."state" = 'accepted'::"PersonalConfigurationChangeState" AND change."requested_patch" = '{"kind":"persona_refresh"}'::jsonb AND change."expected_persona_revision_id" IS NOT DISTINCT FROM profile."active_revision_id" AND change."expected_agent_revision_id" IS NOT DISTINCT FROM service."active_revision_id" FOR UPDATE OF change, service`);
				if (refreshes.length !== 1) return { status: "refresh_unavailable" } as const;

				// 2. Reuse the shared interview primitive after the refresh fence, preserving one lifecycle authority.
				const result = await __StartPersonaInterviewWithinTransaction(transaction, command);
				if (result.status === "started") return result;
				if (result.status === "linked_in_progress") return { status: "already_started", interviewId: result.interviewId } as const;
				if (result.status === "other_in_progress") return { status: "interview_in_progress" } as const;
				return result.status === "linked_closed" ? { status: "refresh_unavailable" } as const : { status: "question_set_unavailable" } as const;
			});
		}
		catch
		{
			return { status: "persistence_unavailable" };
		}
	}
}
