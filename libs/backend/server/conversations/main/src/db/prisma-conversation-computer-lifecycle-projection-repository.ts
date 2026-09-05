import { ArtifactKind, ArtifactState, ConversationLifecycle, ConversationMode, type Prisma } from "@prisma/client";

import type { ConversationComputerCheckpointCatalogue } from "../conversation-computer-checkpoint.types";
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
		return rows.map((row) => ({ siloId, computerId: row.computerId!, conversationId: row.id, agentIdentityId: row.computerAgentIdentityId!, profileRevisionId: row.computerProfileRevisionId! }));
	}

	/** Resolve server-owned history coordinates without trusting them to a workload request. */
	public async resolve(siloId: string, computerId: string): Promise<ConversationComputerCurrentCommand | null>
	{
		const row = await this.prisma.conversation.findFirst({ where: { siloId, computerId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open }, select: { id: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
		if (row === null || row.computerAgentIdentityId === null || row.computerProfileRevisionId === null)
			return null;
		return { siloId, computerId, conversationId: row.id, agentIdentityId: row.computerAgentIdentityId, profileRevisionId: row.computerProfileRevisionId };
	}

	/** Conservatively defer release while the computer conversation owns an unexpired ready attempt key. */
	public async hasActiveAttempt(computerId: string, _leaseId: string): Promise<boolean>
	{
		const conversation = await this.prisma.conversation.findFirst({ where: { computerId }, select: { id: true, siloId: true } });
		if (conversation === null)
			return false;
		const attempt = await this.prisma.conversationComputerAttemptCredential.findFirst({ where: { conversationId: conversation.id, siloId: conversation.siloId, state: "ready", expiresAt: { gt: new Date() } }, select: { bootstrapId: true } });
		return attempt !== null;
	}
}
