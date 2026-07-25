import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { RunAuthoritySource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Reads the one active published revision that may admit a new logical run.
 *
 * This source deliberately re-reads the service after the admission repository has locked it. A
 * stale service state or an active pointer that no longer names a published revision is therefore
 * a refusal, never a best-effort admission of an older revision.
 */
export class PrismaRunAuthoritySource implements RunAuthoritySource
{
	/** Loads the service and its exact active revision through the admission transaction. */
	async load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>
	{
		const service = await transaction.prisma.agentService.findFirst({
			where: { id: command.agentServiceId, siloId: command.siloId, state: AgentServiceState.Active, activeRevisionId: { not: null } },
			select: {
				id: true,
				kind: true,
				activeRevisionId: true,
				activeRevision: { select: { id: true, state: true, digest: true, promptPolicyVersion: true } },
			},
		});
		if (service === null || service.activeRevisionId === null || service.activeRevision === null) return { outcome: "denied", reason: "run_not_admittable" };
		if (service.activeRevision.id !== service.activeRevisionId || service.activeRevision.state !== AgentRevisionState.Published) return { outcome: "denied", reason: "revision_unavailable" };

		return {
			outcome: "loaded",
			value: {
				agentServiceId: service.id,
				agentRevisionId: service.activeRevision.id,
				agentKind: service.kind === AgentServiceKind.Personal ? "personal" : "managed",
				effectiveContractDigest: service.activeRevision.digest,
				promptCompilerVersion: service.activeRevision.promptPolicyVersion,
				trigger: service.kind === AgentServiceKind.Personal ? "interactive" : "managed_invocation",
				delegatedUserId: service.kind === AgentServiceKind.Personal ? command.executionSubjectId : null,
				rootRunId: command.runId,
				parentRunId: null,
			},
		};
	}
}
