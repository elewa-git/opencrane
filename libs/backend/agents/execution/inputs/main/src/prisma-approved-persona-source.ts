import { PersonaRevisionState } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ApprovedPersonaInput, ApprovedPersonaSource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/** Revalidates the active approved persona for a personal run inside final snapshot admission. */
export class PrismaApprovedPersonaSource implements ApprovedPersonaSource
{
	/** Returns no persona for managed work and otherwise accepts only the caller's active approved revision. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		// 1. Managed services must never inherit a human persona merely because their caller has one.
		if (run.agentKind === "managed") return { outcome: "loaded", value: { personaRevisionId: null } };
		// 2. Read the caller-owned profile and its active revision in the same final transaction as the run.
		const profile = await transaction.prisma.personaProfile.findFirst({
			where: { siloId: command.siloId, userId: command.executionSubjectId },
			select: { activeRevisionId: true, activeRevision: { select: { id: true, state: true } } },
		});
		const revision = await transaction.prisma.agentRevision.findFirst({ where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId }, select: { personaRevisionId: true } });
		// 3. Refuse drafts, stale pointers, and missing onboarding approval before the immutable snapshot exists.
		if (profile === null || revision === null || revision.personaRevisionId === null || profile.activeRevisionId === null || profile.activeRevision === null || profile.activeRevision.id !== profile.activeRevisionId || profile.activeRevision.state !== PersonaRevisionState.Approved || revision.personaRevisionId !== profile.activeRevision.id) return { outcome: "denied", reason: "persona_unavailable" };
		return { outcome: "loaded", value: { personaRevisionId: profile.activeRevision.id } };
	}
}
