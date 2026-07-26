import { PersonaRevisionState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Reads the sole approved persona that a personal service may include in a new snapshot. */
export class PrismaApprovedPersonaSource implements ApprovedPersonaSource
{
	/** Returns no persona for managed services, or the exact approved active revision for a personal service. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		// 1. Keep managed services persona-free; their published revision is their complete executable instruction set.
		if (run.agentKind === "managed") return { outcome: "loaded", value: { personaRevisionId: null } };
		if (command.identityKind !== "user") return { outcome: "denied", reason: "persona_unavailable" };
		if (run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId) return { outcome: "denied", reason: "persona_unavailable" };

		// 2. Read the profile through its silo-and-user unique key, never through a revision selected by the caller or service.
		const profile = await transaction.prisma.personaProfile.findUnique({
			where: { siloId_userId: { siloId: command.siloId, userId: run.delegatedUserId } },
			select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } },
		});

		// 3. Refuse an absent or draft active pointer so an unapproved persona cannot enter durable runtime evidence.
		const revision = profile?.activeRevision;
		if (revision === null || revision === undefined || revision.state !== PersonaRevisionState.Approved || revision.personaProfileId.trim().length === 0) return { outcome: "denied", reason: "persona_unavailable" };
		return { outcome: "loaded", value: { personaRevisionId: revision.id } };
	}
}
