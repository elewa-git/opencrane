import { PersonaRevisionState } from "@prisma/client";

import { RunExecutionPersonaPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";

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
	/** Returns the policy-selected persona for the verified execution principal. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		// 1. The run policy, not an identity class, selects whether the published revision needs a persona.
		if (run.executionPolicy.persona === RunExecutionPersonaPolicies.None)
			return { outcome: "loaded", value: { personaRevisionId: null, personaId: null } };
		if (run.executionPolicy.persona !== RunExecutionPersonaPolicies.Required)
		{
			return { outcome: "denied", reason: "persona_unavailable" };
		}

		// 2. Read the profile through the verified principal, never through a caller-selected identity or revision.
		const profile = await transaction.prisma.personaProfile.findUnique({
			where: { siloId_userId: { siloId: command.siloId, userId: executionSubject.principalId } },
			select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } },
		});

		// 3. Refuse when there is no active revision, or it is not approved, so an unapproved persona never reaches a saved run.
		const revision = profile?.activeRevision;
		if (revision === null || revision === undefined || revision.state !== PersonaRevisionState.Approved || revision.personaProfileId.trim().length === 0) return { outcome: "denied", reason: "persona_unavailable" };
		return { outcome: "loaded", value: { personaRevisionId: revision.id, personaId: revision.personaProfileId } };
	}
}
