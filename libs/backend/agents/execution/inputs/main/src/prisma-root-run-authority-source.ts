import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";
import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";

import type { RunAuthoritySource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/**
 * Revalidates the published active revision for an initial root-run admission.
 *
 * It deliberately emits a root lineage only: a governed-child adapter must load and lock its parent
 * independently, then supply the inherited root and parent identifier through its own source.
 */
export class PrismaRootRunAuthoritySource implements RunAuthoritySource
{
	/** Loads the active, published service revision at the final admission fence. */
	async load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>
	{
		// 1. Read the exact same-silo service and active revision inside the caller's admission transaction.
		const service = await transaction.prisma.agentService.findFirst({
			where: { id: command.agentServiceId, siloId: command.siloId },
			select: { id: true, kind: true, state: true, activeRevisionId: true, activeRevision: { select: { id: true, state: true, digest: true, promptPolicyVersion: true, personaRevisionId: true } } },
		});
		// 2. Reject unavailable or unpublished heads so a run cannot pin a draft, retired, or replaced service.
		if (service === null || service.state !== AgentServiceState.Active || service.activeRevisionId === null || service.activeRevision === null || service.activeRevision.id !== service.activeRevisionId || service.activeRevision.state !== AgentRevisionState.Published) return { outcome: "denied", reason: "revision_unavailable" };
		if (service.kind !== AgentServiceKind.Personal && service.kind !== AgentServiceKind.Managed) return { outcome: "denied", reason: "run_not_admittable" };
		if (service.kind === AgentServiceKind.Personal && command.threadId === null) return { outcome: "denied", reason: "run_not_admittable" };
		if (service.kind === AgentServiceKind.Managed && command.threadId !== null) return { outcome: "denied", reason: "run_not_admittable" };
		if (service.kind === AgentServiceKind.Managed && service.activeRevision.personaRevisionId !== null) return { outcome: "denied", reason: "run_not_admittable" };
		if (service.activeRevision.promptPolicyVersion !== PROMPT_COMPILER_VERSION) return { outcome: "denied", reason: "revision_unavailable" };
		// 3. Freeze root lineage at the caller-provided run ID; only a dedicated child authority may inherit it.
		return { outcome: "loaded", value: { agentServiceId: service.id, agentRevisionId: service.activeRevision.id, agentKind: service.kind === AgentServiceKind.Personal ? "personal" : "managed", effectiveContractDigest: service.activeRevision.digest, promptCompilerVersion: PROMPT_COMPILER_VERSION, trigger: service.kind === AgentServiceKind.Personal ? "interactive" : "managed_invocation", delegatedUserId: service.kind === AgentServiceKind.Personal ? command.executionSubjectId : null, rootRunId: command.runId, parentRunId: null } };
	}
}
