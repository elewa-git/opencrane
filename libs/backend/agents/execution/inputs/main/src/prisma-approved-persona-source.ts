import { PersonaRevisionState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Transaction-fenced source for the single approved persona a personal run may compile. */
export class PrismaApprovedPersonaSource implements ApprovedPersonaSource
{
	/** Load an active approved persona for a personal delegated user, or none for a managed run. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		if (run.agentKind === "managed") return { outcome: "loaded", value: { personaRevisionId: null } };
		if (run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId) return { outcome: "denied", reason: "persona_unavailable" };

		// 1. Bind the profile to the exact delegated user and silo rather than accepting a service-selected persona.
		const profile = await transaction.prisma.personaProfile.findUnique({
			where: { siloId_userId: { siloId: command.siloId, userId: run.delegatedUserId } },
			select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } },
		});
		// 2. Require the profile's current revision to remain approved at the same admission fence.
		const revision = profile?.activeRevision;
		if (revision === null || revision === undefined || revision.state !== PersonaRevisionState.Approved || revision.personaProfileId.trim().length === 0) return { outcome: "denied", reason: "persona_unavailable" };

		return { outcome: "loaded", value: { personaRevisionId: revision.id } };
	}
}
