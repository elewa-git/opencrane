import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { ExecutionSubjectAuthority, SessionAssemblyCommand } from "../assembly/session-assembly.types";

/**
 * Selects one identity authority from the service currently published in the admission transaction.
 *
 * Called by: conversation run composition, which supplies independently configured personal and
 * managed authorities. A denial never falls through to another identity kind.
 * @see PrismaRunAuthority for the corresponding current revision input policy.
 */
export class PrismaConversationExecutionSubjectAuthority implements ExecutionSubjectAuthority
{
	/** Receives both closed authorities without accepting a caller-selected identity mode. */
	public constructor(private readonly prisma: Prisma.TransactionClient, private readonly personal: ExecutionSubjectAuthority, private readonly managed: ExecutionSubjectAuthority) {}

	/** Reads exact service lifecycle and kind before dispatching to its sole permitted identity authority. */
	public async load(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]): ReturnType<ExecutionSubjectAuthority["load"]>
	{
		const service = await this.prisma.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, state: AgentServiceState.Active, activeRevisionId: run.agentRevisionId, activeRevision: { is: { state: AgentRevisionState.Published } } }, select: { kind: true } });
		if (service?.kind === AgentServiceKind.Personal)
			return this.personal.load(command, run, transaction);
		if (service?.kind === AgentServiceKind.Managed)
			return this.managed.load(command, run, transaction);
		return { outcome: "denied", reason: "identity_unavailable" };
	}
}
