import { AgentRevisionState, AgentServiceKind, AgentServiceState } from "@prisma/client";

import { RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type InitialRunAuthority, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { RunAuthoritySource, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";

/**
 * Re-reads the active, published revision this run is allowed to use.
 *
 * The admission repository already holds the service-level idempotency and concurrency lock. This
 * source deliberately reads the service again inside that transaction so a pause, retirement, or
 * active-revision swap cannot let an earlier command admit a stale revision.
 *
 * It also requires the loaded revision and the service's `activeRevisionId` to agree. They can
 * differ mid-swap, and admitting on the difference would run instructions that are no longer the
 * service's current ones.
 *
 * Runs first among the input sources; every other source is given the facts it returns.
 *
 * @implements RunAuthoritySource
 */
export class PrismaRunAuthoritySource implements RunAuthoritySource
{
	/** Loads the service only if it is active, and only the published revision its activeRevisionId points to. */
	async load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>
	{
		// 1. Re-read the service in this silo now that admission has put competing commands in order.
		const service = await transaction.prisma.agentService.findFirst({
			where: { id: command.agentServiceId, siloId: command.siloId, state: AgentServiceState.Active, activeRevisionId: { not: null } },
			select: {
				id: true,
				kind: true,
				activeRevisionId: true,
				activeRevision: { select: { id: true, state: true, promptPolicyVersion: true } },
			},
		});
		if (service === null || service.activeRevisionId === null || service.activeRevision === null)
		{
			return { outcome: "denied", reason: "run_not_admittable" };
		}

		// 2. The loaded revision and activeRevisionId must match, so an old published revision cannot survive an active-revision swap.
		if (service.activeRevision.id !== service.activeRevisionId || service.activeRevision.state !== AgentRevisionState.Published)
		{
			return { outcome: "denied", reason: "revision_unavailable" };
		}

		// 3. Build the run facts from the revision just read, not from anything the caller sent.
		return {
			outcome: "loaded",
			value: {
				agentServiceId: service.id,
				agentRevisionId: service.activeRevision.id,
				executionPolicy: service.kind === AgentServiceKind.Personal
					? { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed }
					: { persona: RunExecutionPersonaPolicies.None, personalMemory: RunExecutionPersonalMemoryPolicies.None },
				promptCompilerVersion: service.activeRevision.promptPolicyVersion,
				trigger: command.trigger,
				rootRunId: command.runId,
				parentRunId: null,
			},
		};
	}
}
