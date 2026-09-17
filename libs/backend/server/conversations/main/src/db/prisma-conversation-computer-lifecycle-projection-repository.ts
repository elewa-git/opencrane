import { AgentRunState, AgentRunTerminalReason, ApprovalRequestState, ArtifactKind, ArtifactState, ConversationLifecycle, ConversationMode, type Prisma } from "@prisma/client";
import { ___ExecutionSubjectSchema } from "@opencrane/contracts";

import type { ConversationComputerActiveLeaseProjectionCommand } from "../conversation-computer-activation.types";
import type { ConversationComputerCheckpointCatalogue } from "../conversation-computer-checkpoint.types";
import type { ConversationComputerLeaseProjectionCommand } from "../conversation-computer-lifecycle.types";
import type { ConversationComputerCurrentCommand } from "../conversation-computers";

/** Owns the rebuildable computer coordinates and generated checkpoint Artifact projection. */
export class PrismaConversationComputerLifecycleProjectionRepository implements ConversationComputerCheckpointCatalogue
{
	/** Receives the exact Prisma binding selected by the app composition owner. */
	public constructor(private readonly prisma: Prisma.TransactionClient) {}

	/** Idempotently creates the deterministic active generated Artifact and rejects coordinate drift. */
	public async ensureGeneratedArtifact(input: { readonly artifactId: string; readonly siloId: string; readonly ownerPrincipalId: string }): Promise<void>
	{
		await this.prisma.artifact.upsert({ where: { id: input.artifactId }, create: { id: input.artifactId, siloId: input.siloId, ownerPrincipalId: input.ownerPrincipalId, kind: ArtifactKind.Generated }, update: {} });
		const artifact = await this.prisma.artifact.findFirst({ where: { id: input.artifactId, siloId: input.siloId, ownerPrincipalId: input.ownerPrincipalId, kind: ArtifactKind.Generated, state: ArtifactState.Active }, select: { id: true } });
		if (artifact === null)
			throw new Error("Conversation computer checkpoint artifact conflicts with its deterministic owner");
	}

	/** Enumerate one stable page of open agent-session coordinates for Kurrent-owned filtering. */
	public async enumerate(siloId: string, afterConversationId: string | null, limit: number)
	{
		const rows = await this.prisma.conversation.findMany({
			where: {
				siloId,
				mode: ConversationMode.AgentSession,
				lifecycle: ConversationLifecycle.Open,
				id: afterConversationId === null ? undefined : { gt: afterConversationId },
				computerId: { not: null },
				computerAgentIdentityId: { not: null },
				computerProfileRevisionId: { not: null },
			},
			select: {
				id: true,
				computerId: true,
				computerAgentIdentityId: true,
				computerProfileRevisionId: true,
			},
			orderBy: { id: "asc" },
			take: limit,
		});

		return {
			items: rows.map(row => ({
				computer: {
					siloId,
					computerId: row.computerId!,
					conversationId: row.id,
					agentIdentityId: row.computerAgentIdentityId!,
				},
				profileRevisionId: row.computerProfileRevisionId!,
			})),
			nextCursor: rows.length === limit ? rows.at(-1)?.id ?? null : null,
		};
	}

	/** Resolve server-owned history coordinates without trusting them to a workload request. */
	public async resolve(siloId: string, computerId: string): Promise<ConversationComputerCurrentCommand | null>
	{
		const row = await this.prisma.conversation.findFirst({ where: { siloId, computerId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open }, select: { id: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
		if (row === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null)
			return null;
		return {
			computer: {
				siloId,
				computerId,
				conversationId: row.id,
				agentIdentityId: row.computerAgentIdentityId,
			},
			profileRevisionId: row.computerProfileRevisionId,
		};
	}

	/** List accepted or running computer attempts that Tier 2 may need to reconcile after restart. */
	public listActiveRuns(siloId: string)
	{
		return this.prisma.agentRun.findMany({
			where: {
				siloId,
				state: { in: [AgentRunState.Accepted, AgentRunState.Running] },
				conversation: { is: { computerId: { not: null } } },
			},
			select: { id: true, attempt: true, executionSubject: true },
		});
	}

	/** Report whether the relational active-lease fence still names the exact admitted attempt. */
	public async hasActiveLease(siloId: string, computerId: string, lease: { readonly leaseId: string; readonly leaseGeneration: number }): Promise<boolean>
	{
		const current = await this.prisma.conversationComputerActiveLease.findFirst({ where: { siloId, computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration }, select: { computerId: true } });
		return current !== null;
	}

	/** Move the projected expiry later for exactly the canonical lease that history just renewed. */
	public async extendActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<boolean>
	{
		const expiresAt = new Date(command.lease.expiresAt);
		if (Number.isNaN(expiresAt.getTime()))
			throw new Error("Conversation computer active lease renewal requires a valid expiry");
		const touched = await this.prisma.conversationComputerActiveLease.updateMany({ where: { ..._ActiveLeaseRow(command), expiresAt: { lt: expiresAt } }, data: { expiresAt } });
		return touched.count === 1;
	}

	/** Remove only an idle exact lease while holding the same row fence used by attempt admission. */
	public async clearActiveLease(command: ConversationComputerLeaseProjectionCommand): Promise<boolean>
	{
		const row = _ActiveLeaseRow(command);
		const touched = await this.prisma.conversationComputerActiveLease.updateMany({ where: row, data: { updatedAt: new Date() } });
		if (touched.count === 0)
		{
			const current = await this.prisma.conversationComputerActiveLease.findUnique({ where: { computerId: row.computerId }, select: { computerId: true } });
			return current === null;
		}
		const pending = await this.prisma.approvalRequest.count({ where: { state: ApprovalRequestState.Pending, run: { conversationId: row.conversationId } } });
		if (pending > 0)
			return false;
		const attempts = await this.prisma.conversationComputerAttemptCredential.count({ where: { conversationId: row.conversationId, siloId: row.siloId, state: "ready", expiresAt: { gt: new Date() } } });
		if (attempts > 0)
			return false;
		const deleted = await this.prisma.conversationComputerActiveLease.deleteMany({ where: row });
		if (deleted.count === 1)
			return true;
		const current = await this.prisma.conversationComputerActiveLease.findUnique({ where: { computerId: row.computerId }, select: { computerId: true } });
		return current === null;
	}

	/** Atomically fail an admitted run that never froze a turn and clear its exact lost lease. */
	public async failUnfrozenRunAndClearActiveLease(command: ConversationComputerLeaseProjectionCommand): Promise<boolean>
	{
		const active = await this.prisma.agentRun.findMany({ where: { siloId: command.computer.siloId, conversationId: command.computer.conversationId, state: { in: [AgentRunState.Accepted, AgentRunState.Running] } }, select: { id: true, attempt: true, state: true, executionSubject: true } });
		const matching = active.filter(function _Matches(run)
		{
			const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
			return subject.success
				&& subject.data.runScope.runId === run.id
				&& subject.data.runScope.attempt === run.attempt
				&& subject.data.computerScope.computerId === command.computer.computerId
				&& subject.data.computerScope.leaseId === command.lease.leaseId
				&& subject.data.computerScope.leaseGeneration === command.lease.leaseGeneration;
		});
		if (matching.length !== active.length)
			throw new Error("Conversation computer lost lease conflicts with another active run");
		if (matching.length > 1)
			throw new Error("Conversation computer lost lease has multiple active runs");
		if (matching[0]?.state === AgentRunState.Running)
			throw new Error("Conversation computer running attempt is missing its durable turn");
		if (matching[0]?.state === AgentRunState.Accepted)
		{
			const failed = await this.prisma.agentRun.updateMany({ where: { id: matching[0].id, siloId: command.computer.siloId, attempt: matching[0].attempt, state: AgentRunState.Accepted }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: new Date() } });
			if (failed.count !== 1)
				throw new Error("Conversation computer lost its unfrozen run failure fence");
		}
		const cleared = await this.clearActiveLease(command);
		if (!cleared)
			throw new Error("Conversation computer could not clear the failed unfrozen run lease");
		return true;
	}
}

/** Flatten the computer and lease bundles into the exact `ConversationComputerActiveLease` row columns. */
function _ActiveLeaseRow(command: ConversationComputerLeaseProjectionCommand)
{
	const { computer, lease } = command;
	return {
		siloId: computer.siloId,
		conversationId: computer.conversationId,
		computerId: computer.computerId,
		agentIdentityId: computer.agentIdentityId,
		leaseId: lease.leaseId,
		leaseGeneration: lease.leaseGeneration,
	};
}
