import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationToolDispatchDependencies } from "./conversation-tool-dispatch.types";
import type { ConversationToolComputerCoordinates, ConversationToolComputerEvidence, ConversationToolRunEvidence } from "./conversation-tool-dispatch-evidence.types";

/** Reads current identity and lease history after resolving the computer's server-owned coordinates. */
export class ConversationToolComputerEvidenceReader
{
	/** History readers may throw; unavailable history must roll back the caller's transaction. */
	public constructor(private readonly projection: ConversationToolComputerCoordinates, private readonly dependencies: Pick<ConversationToolDispatchDependencies, "identities" | "computers">) {}

	/** Return null for an inactive or replaced identity or lease, without changing either. */
	public async load(run: ConversationToolRunEvidence, now: Date): Promise<ConversationToolComputerEvidence | null>
	{
		const { subject } = run;
		const coordinates = await this.projection.resolve(run.siloId, subject.computerScope.computerId);
		if (coordinates === null || coordinates.computer.conversationId !== run.conversationId || coordinates.computer.agentIdentityId !== subject.agentIdentityId)
			return null;
		const identity = await this.dependencies.identities.load({
			siloId: run.siloId, agentIdentityId: subject.agentIdentityId,
			agentServiceId: subject.runScope.agentServiceId, principalId: subject.principalId,
		});
		if (identity === null || identity.identity.state !== AgentIdentityStates.Active || identity.headDigest !== subject.identity.headDigest || identity.revision.toString() !== subject.identity.headRevision)
			return null;
		const current = await this.dependencies.computers.load(coordinates);
		const lease = current?.lease;
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || lease === null || lease === undefined
			|| lease.state !== ComputerLeaseStates.Active || lease.id !== subject.computerScope.leaseId
			|| lease.generation !== subject.computerScope.leaseGeneration || current.computer.leaseGeneration !== lease.generation
			|| lease.computerId !== subject.computerScope.computerId || lease.sandboxId === null || Date.parse(lease.expiresAt) <= now.getTime())
			return null;
		return { identity: identity.identity, leaseExpiresAtEpochMs: Date.parse(lease.expiresAt) };
	}
}
