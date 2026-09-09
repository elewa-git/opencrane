import { ApprovalRequestState, ArtifactKind, ArtifactState, ConversationLifecycle, ConversationMode, type Prisma } from "@prisma/client";

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

	/** Enumerate open agent-session projection coordinates for Kurrent-owned lifecycle filtering. */
	public async enumerate(siloId: string, limit: number): Promise<readonly ConversationComputerCurrentCommand[]>
	{
		const rows = await this.prisma.conversation.findMany({ where: { siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, computerId: { not: null }, computerAgentIdentityId: { not: null }, computerProfileRevisionId: { not: null } }, select: { id: true, computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true }, orderBy: { id: "asc" }, take: limit });
		return rows.map((row) => ({ computer: { siloId, computerId: row.computerId!, conversationId: row.id, agentIdentityId: row.computerAgentIdentityId! }, profileRevisionId: row.computerProfileRevisionId! }));
	}

	/** Resolve server-owned history coordinates without trusting them to a workload request. */
	public async resolve(siloId: string, computerId: string): Promise<ConversationComputerCurrentCommand | null>
	{
		const row = await this.prisma.conversation.findFirst({ where: { siloId, computerId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open }, select: { id: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
		if (row === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null)
			return null;
		return { computer: { siloId, computerId, conversationId: row.id, agentIdentityId: row.computerAgentIdentityId }, profileRevisionId: row.computerProfileRevisionId };
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
}

/** Flatten the computer and lease bundles into the exact `ConversationComputerActiveLease` row columns. */
function _ActiveLeaseRow(command: ConversationComputerLeaseProjectionCommand)
{
	const { computer, lease } = command;
	return { siloId: computer.siloId, conversationId: computer.conversationId, computerId: computer.computerId, agentIdentityId: computer.agentIdentityId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration };
}
