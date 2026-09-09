import { PersonaRevisionState, Prisma } from "@prisma/client";

import { RunExecutionPersonaPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "../assembly/session-assembly.types";

/**
 * Reads the one approved persona a personal service may put in a new snapshot.
 *
 * Resolves the verified local Principal to its sign-in subject, then reads that user's profile in
 * the same silo and follows its active-revision pointer. Neither the caller nor the service can
 * name which user or revision to use. An active
 * revision that is not approved is refused rather than used.
 *
 * @implements ApprovedPersonaSource
 */
export class PrismaApprovedPersonaAuthority implements ApprovedPersonaSource
{
	/** Binds persona reads to one admission transaction. */
	constructor(private readonly prisma: Prisma.TransactionClient) {}

	/** Returns the policy-selected persona for the verified execution principal. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, _transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		// 1. The run policy, not an identity class, selects whether the published revision needs a persona.
		if (run.executionPolicy.persona === RunExecutionPersonaPolicies.None)
			return { outcome: "loaded", value: { personaRevisionId: null, personaId: null } };
		if (run.executionPolicy.persona !== RunExecutionPersonaPolicies.Required)
		{
			return { outcome: "denied", reason: "persona_unavailable" };
		}

		// 2. Onboarding stores profiles under the sign-in subject, while execution carries the local Principal id.
		const principal = await this.prisma.principal.findUnique({ where: { id_siloId: { id: executionSubject.principalId, siloId: command.siloId } }, select: { subject: true } });
		if (principal === null || principal.subject.trim().length === 0)
			return { outcome: "denied", reason: "persona_unavailable" };
		const profile = await this.prisma.personaProfile.findUnique({
			where: { siloId_userId: { siloId: command.siloId, userId: principal.subject } },
			select: { activeRevision: { select: { id: true, state: true, personaProfileId: true } } },
		});

		// 3. Refuse when there is no active revision, or it is not approved, so an unapproved persona never reaches a saved run.
		const revision = profile?.activeRevision;
		if (revision === null || revision === undefined || revision.state !== PersonaRevisionState.Approved || revision.personaProfileId.trim().length === 0)
			return { outcome: "denied", reason: "persona_unavailable" };
		return { outcome: "loaded", value: { personaRevisionId: revision.id, personaId: revision.personaProfileId } };
	}
}
