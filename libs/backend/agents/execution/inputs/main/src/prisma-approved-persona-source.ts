import { PersonaRevisionState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Reads the one approved persona a personal service may put in a new snapshot.
 *
 * Reads the persona profile by its silo-and-user key and follows that profile's own active-revision
 * pointer, so neither the caller nor the service can name which revision to use. An active
 * revision that is not approved is refused rather than used.
 *
 * @implements ApprovedPersonaSource
 */
export class PrismaApprovedPersonaSource implements ApprovedPersonaSource
{
	/** Returns no persona for a managed service, or the active approved revision for a personal service. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		// 1. Managed services get no persona: their published revision already holds all their instructions.
		if (run.agentKind === "managed") return { outcome: "loaded", value: { personaRevisionId: null } };
		if (command.identityKind !== "user") return { outcome: "denied", reason: "persona_unavailable" };
		if (run.delegatedUserId === null || run.delegatedUserId !== command.executionSubjectId) return { outcome: "denied", reason: "persona_unavailable" };

		// 2. Read the profile through its silo-and-user unique key, never through a revision selected by the caller or service.
		const profile = await transaction.prisma.personaProfile.findUnique({
			where: { siloId_userId: { siloId: command.siloId, userId: run.delegatedUserId } },
			select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } },
		});

		// 3. Refuse when there is no active revision, or it is not approved, so an unapproved persona never reaches a saved run.
		const revision = profile?.activeRevision;
		if (revision === null || revision === undefined || revision.state !== PersonaRevisionState.Approved || revision.personaProfileId.trim().length === 0) return { outcome: "denied", reason: "persona_unavailable" };
		return { outcome: "loaded", value: { personaRevisionId: revision.id } };
	}
}
