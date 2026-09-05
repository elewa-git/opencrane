import { createHash } from "node:crypto";

import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease } from "@opencrane/contracts";
import type { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivationAuthority, ConversationComputerActivationCommand, ConversationComputerActivationOutcome, ConversationComputerActivationProfile, ConversationComputerActivationProjectionRepository } from "./conversation-computer-activation.types";
import { ConversationComputerHistory } from "./conversation-computers";

/** Realizes activation requests through one release-owned Agent Sandbox profile. */
export class ConversationComputerActivationAuthorityAdapter implements ConversationComputerActivationAuthority
{
	/** Reads and appends the durable computer aggregate. */
	private readonly computers: ConversationComputerHistory;

	/** Connects relational coordinate lookup, Kurrent history, and the sole SandboxClaim mutator. */
	public constructor(private readonly projections: ConversationComputerActivationProjectionRepository, historyStore: Pick<HistoryStore, "append" | "readHead" | "readStream">, private readonly claims: Pick<AgentSandboxClaimAdapter, "claim">, private readonly profile: ConversationComputerActivationProfile)
	{
		this.computers = new ConversationComputerHistory(historyStore);
	}

	/** Reserve or observe the exact generation, and acknowledge only after a sandbox is assigned. */
	public async activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>
	{
		// 1. Resolve immutable identity and profile coordinates from the server-owned projection.
		const projection = await this.projections.resolve(command);
		if (projection === null)
			return "denied";
		if (projection.profileRevisionId !== this.profile.profileRevisionId)
			return { action: "park", reason: "conversation computer profile is not admitted by this release" };
		const coordinates = { siloId: command.siloId, computerId: command.computerId, conversationId: command.conversationId, agentIdentityId: projection.agentIdentityId, profileRevisionId: projection.profileRevisionId };
		let current = await this.computers.load(coordinates);
		if (current === null || current.computer.state === ConversationComputerStates.Retired)
			return "denied";
		if (current.computer.state === ConversationComputerStates.Warm && current.lease?.state === ComputerLeaseStates.Active)
		{
			await this.projections.publishActiveLease(_ActiveProjection(current.computer.siloId, current.computer.conversationId, current.computer.agentIdentityId, current.lease));
			return "idempotent";
		}
		if (current.computer.state === ConversationComputerStates.Cooling && current.lease?.state === ComputerLeaseStates.Active && current.computer.leaseGeneration === command.generation)
		{
			const reactivatedAt = new Date().toISOString();
			await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-reactivated", `${current.lease.id}:${command.generation}:${current.revision}`), computer: { ...current.computer, state: ConversationComputerStates.Warm, updatedAt: reactivatedAt }, lease: current.lease });
			await this.projections.publishActiveLease(_ActiveProjection(current.computer.siloId, current.computer.conversationId, current.computer.agentIdentityId, current.lease));
			return "activated";
		}

		// 2. Persist the generation reservation before creating an external claim, so a retry has one owner.
		const now = new Date();
		const expiresAt = new Date(now.getTime() + this.profile.leaseTtlMilliseconds).toISOString();
		const initialClaim = current.computer.state === ConversationComputerStates.Cold && current.lease === null && current.computer.leaseGeneration === command.generation;
		const recoveryClaim = (current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.Cooling) && current.lease?.state === ComputerLeaseStates.Released && current.computer.leaseGeneration + 1 === command.generation;
		if (initialClaim || recoveryClaim)
		{
			const lease = _ClaimedLease(command.computerId, command.generation, now.toISOString(), expiresAt);
			await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-claim-pending", lease.id), computer: { ...current.computer, state: ConversationComputerStates.ClaimPending, leaseGeneration: command.generation, updatedAt: now.toISOString() }, lease });
			current = await this.computers.load(coordinates);
		}
		if (current === null || current.computer.state !== ConversationComputerStates.ClaimPending || current.lease?.state !== ComputerLeaseStates.Claimed)
			return "denied";

		// 3. Converge the deterministic claim and retain delivery until its controller assigns a sandbox.
		const claim = await this.claims.claim({ siloId: command.siloId, computerId: command.computerId, leaseId: current.lease.id, generation: command.generation, namespace: this.profile.namespace, profileName: this.profile.profileName, warmPoolName: this.profile.warmPoolName, expiresAt: current.lease.expiresAt, reason: current.computer.workspaceCheckpoint === null ? "activation_requested" : "recovery_requested" });
		if (claim.sandboxId === null || claim.serviceFQDN === null)
			throw new Error("Agent Sandbox has not assigned the conversation computer yet");

		// 4. Fence the assigned sandbox into history before the queue acknowledges activation.
		const activeLease: ComputerLease = { ...current.lease, sandboxClaimId: claim.claimId, sandboxId: claim.sandboxId, serviceFQDN: claim.serviceFQDN, state: ComputerLeaseStates.Active };
		await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-lease-active", activeLease.id), computer: { ...current.computer, state: ConversationComputerStates.Warm, updatedAt: new Date().toISOString() }, lease: activeLease });
		await this.projections.publishActiveLease(_ActiveProjection(current.computer.siloId, current.computer.conversationId, current.computer.agentIdentityId, activeLease));
		return "activated";
	}
}

/** Convert canonical active history into the exact rebuildable transaction fence. */
function _ActiveProjection(siloId: string, conversationId: string, agentIdentityId: string, lease: ComputerLease)
{
	return { siloId, conversationId, computerId: lease.computerId, agentIdentityId, leaseId: lease.id, leaseGeneration: lease.generation, expiresAt: lease.expiresAt };
}

/** Build a deterministic DNS-label lease so redelivery cannot reserve a second realization. */
function _ClaimedLease(computerId: string, generation: number, claimedAt: string, expiresAt: string): ComputerLease
{
	const digest = createHash("sha256").update(`${computerId}:${generation}`, "utf8").digest("hex").slice(0, 24);
	const claimId = `${computerId}-g${generation}`;
	return { schemaVersion: 1, id: `lease-${digest}`, computerId, generation, sandboxClaimId: claimId, sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, claimedAt, expiresAt, releasedAt: null };
}

/** Derive one stable RFC 4122 version-five-shaped event identifier. */
function _Uuid(namespace: string, coordinate: string): string
{
	const bytes = Buffer.from(createHash("sha256").update(`${namespace}\u0000${coordinate}`, "utf8").digest().subarray(0, 16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
