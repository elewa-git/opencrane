import { PreferenceFactConsentState, PreferenceFactState } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { PreferenceFactSource, SessionAssemblyCommand, SessionAssemblyLoad } from "@opencrane/backend/agents/execution/inputs";

/** Admission-time source that freezes only current, consented facts belonging to the personal run owner. */
export class PrismaPreferenceFactSource implements PreferenceFactSource
{
	/** Loads prompt-eligible fact IDs through the caller's existing admission transaction. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<readonly { readonly id: string }[]>>
	{
		// 1. Managed runs have no personal layer and therefore freeze no user preference facts.
		if (run.agentKind !== "personal") return { outcome: "loaded", value: [] };

		// 2. Revalidate the published persona's exact profile owner inside the admission transaction.
		const revision = await transaction.prisma.agentRevision.findFirst({ where: { id: run.agentRevisionId, agentServiceId: run.agentServiceId }, select: { personaRevisionId: true } });
		const persona = revision?.personaRevisionId === null || revision?.personaRevisionId === undefined ? null : await transaction.prisma.personaRevision.findUnique({ where: { id: revision.personaRevisionId }, select: { personaProfileId: true, profile: { select: { siloId: true, userId: true } } } });
		if (persona === null || persona === undefined || persona.profile.siloId !== command.siloId || persona.profile.userId !== command.executionSubjectId) return { outcome: "denied", reason: "persona_unavailable" };

		// 3. Select only accepted consented facts now; later correction or forget affects only a later admission.
		const facts = await transaction.prisma.preferenceFact.findMany({ where: { siloId: command.siloId, userId: command.executionSubjectId, personaProfileId: persona.personaProfileId, state: PreferenceFactState.Accepted, consentState: { in: [PreferenceFactConsentState.Explicit, PreferenceFactConsentState.Confirmed] } }, select: { id: true }, orderBy: [{ preferenceKey: "asc" }, { id: "asc" }] });
		return { outcome: "loaded", value: facts };
	}
}
