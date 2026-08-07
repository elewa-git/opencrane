import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { AgentServiceKinds } from "@opencrane/models/agents";

import type { RunAuthoritySource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types.js";

/**
 * Re-reads the exact active, published revision that may admit one logical run.
 *
 * The admission repository already holds the service-level idempotency and concurrency lock. This
 * source deliberately reads the service again inside that transaction so a pause, retirement, or
 * active-revision swap cannot let an earlier command admit a stale revision.
 */
export class PrismaRunAuthoritySource implements RunAuthoritySource
{
	/** Loads only an active service and the published revision named by its active pointer. */
	async load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>
	{
		// 1. Re-read the exact same-silo service after admission has serialized competing commands.
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
		if ((service.kind === AgentServiceKind.Personal && command.identityKind !== "user") || (service.kind === AgentServiceKind.Managed && command.identityKind !== "service")) return { outcome: "denied", reason: "run_not_admittable" };

		// 2. Require the relation and pointer to agree, so an obsolete published revision cannot survive a swap.
		if (service.activeRevision.id !== service.activeRevisionId || service.activeRevision.state !== AgentRevisionState.Published) return { outcome: "denied", reason: "revision_unavailable" };

		// 3. Bind the initial authority to the current revision rather than a caller-selected lifecycle fact.
		return {
			outcome: "loaded",
			value: {
				agentServiceId: service.id,
				agentRevisionId: service.activeRevision.id,
				agentKind: service.kind === AgentServiceKind.Personal ? AgentServiceKinds.Personal : AgentServiceKinds.Managed,
				effectiveContractDigest: service.activeRevision.digest,
				promptCompilerVersion: service.activeRevision.promptPolicyVersion,
				trigger: command.trigger,
				delegatedUserId: command.identityKind === "user" ? command.executionSubjectId : null,
				rootRunId: command.runId,
				parentRunId: null,
			},
		};
	}
}
