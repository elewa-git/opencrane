import { createHash } from "node:crypto";

import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import type { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationComputerActivationQueueActions, type ConversationComputerActivationAuthority, type ConversationComputerActivationCommand, type ConversationComputerActiveLeaseProjectionCommand, type ConversationComputerActivationOutcome, type ConversationComputerActivationProfile, type ConversationComputerActivationProjectionRepository } from "./conversation-computer-activation.types";
import { ConversationComputerHistory, _ComputerScopeOf, _LeaseScopeOf } from "@opencrane/backend/server/conversations/computers";

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

	/** Reserve or observe the exact generation, and report pending until a sandbox is assigned. */
	public async activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>
	{
		// 1. Resolve immutable identity and profile coordinates from the server-owned projection.
		const projection = await this.projections.resolve(command);
		if (projection === null)
			return "denied";
		if (projection.profileRevisionId !== this.profile.profileRevisionId)
			return { action: ConversationComputerActivationQueueActions.Park, reason: "conversation computer profile is not admitted by this release" };
		const coordinates = { computer: { siloId: command.siloId, computerId: command.computerId, conversationId: command.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId };
		let current = await this.computers.load(coordinates);
		if (current === null || current.computer.state === ConversationComputerStates.Retired)
			return "denied";
		const now = new Date();
		const lease = current.lease;
		const currentActiveLease = _IsCurrentActiveLease(current.computer.leaseGeneration, lease, command.generation, now);
		if (current.computer.state === ConversationComputerStates.Warm && currentActiveLease)
		{
			await this.projections.publishActiveLease(_ActiveProjection(current.computer, lease), command);
			return "idempotent";
		}
		if (current.computer.state === ConversationComputerStates.Cooling && currentActiveLease)
		{
			const reactivatedAt = now.toISOString();
			await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-reactivated", `${lease.id}:${command.generation}:${current.revision}`), computer: { ...current.computer, state: ConversationComputerStates.Warm, updatedAt: reactivatedAt }, lease });
			await this.projections.publishActiveLease(_ActiveProjection(current.computer, lease), command);
			return "activated";
		}

		// 2. Persist the generation reservation before creating an external claim, so a retry has one owner.
		const expiresAt = new Date(now.getTime() + this.profile.leaseTtlMilliseconds).toISOString();
		const initialClaim = current.computer.state === ConversationComputerStates.Cold && current.lease === null && current.computer.leaseGeneration === command.generation;
		const recoveryClaim = (current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.Cooling) && _IsTerminalLease(current.lease) && current.computer.leaseGeneration + 1 === command.generation;
		if (initialClaim || recoveryClaim)
		{
			const lease = _ClaimedLease(command.computerId, command.generation, now.toISOString(), expiresAt);
			await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-claim-pending", lease.id), computer: { ...current.computer, state: ConversationComputerStates.ClaimPending, leaseGeneration: command.generation, updatedAt: now.toISOString() }, lease });
			current = await this.computers.load(coordinates);
		}
		if (current === null)
			return "denied";
		// A competing consumer may have finished this generation between our load and reload; report
		// that as the idempotent replay it is instead of a denial.
		if (current.computer.state === ConversationComputerStates.Warm && _IsCurrentActiveLease(current.computer.leaseGeneration, current.lease, command.generation, new Date()))
		{
			await this.projections.publishActiveLease(_ActiveProjection(current.computer, current.lease), command);
			return "idempotent";
		}
		if (current.computer.state !== ConversationComputerStates.ClaimPending || current.lease?.state !== ComputerLeaseStates.Claimed)
			return "denied";

		// 3. Converge the deterministic claim and keep the delivery live until its controller assigns a sandbox.
		const claim = await this.claims.claim({ siloId: command.siloId, computerId: command.computerId, leaseId: current.lease.id, generation: command.generation, namespace: this.profile.namespace, profileName: this.profile.profileName, warmPoolName: this.profile.warmPoolName, expiresAt: current.lease.expiresAt, reason: current.computer.workspaceCheckpoint === null ? "activation_requested" : "recovery_requested" });
		if (claim.sandboxId === null || claim.serviceFQDN === null)
			return { action: ConversationComputerActivationQueueActions.Retry, reason: "Agent Sandbox has not assigned the conversation computer yet" };

		// 4. Fence the assigned sandbox into history before the queue acknowledges activation.
		const activeLease: ComputerLease = { ...current.lease, sandboxClaimId: claim.claimId, sandboxId: claim.sandboxId, serviceFQDN: claim.serviceFQDN, state: ComputerLeaseStates.Active };
		await this.computers.append({ expectedRevision: current.revision, eventId: _Uuid("computer-lease-active", activeLease.id), computer: { ...current.computer, state: ConversationComputerStates.Warm, updatedAt: new Date().toISOString() }, lease: activeLease });
		await this.projections.publishActiveLease(_ActiveProjection(current.computer, activeLease), command);
		return "activated";
	}
}

/** Recognize a lease that ended, by orderly release or by loss, so the next generation may open. */
function _IsTerminalLease(lease: ComputerLease | null): boolean
{
	return lease?.state === ComputerLeaseStates.Released || lease?.state === ComputerLeaseStates.Lost;
}

/** Accept only the requested, unexpired active generation for replay or reactivation. */
function _IsCurrentActiveLease(currentGeneration: number, lease: ComputerLease | null, requestedGeneration: number, now: Date): lease is ComputerLease
{
	return currentGeneration === requestedGeneration && lease?.state === ComputerLeaseStates.Active && lease.generation === requestedGeneration && Date.parse(lease.expiresAt) > now.getTime();
}

/** Convert canonical active history into the exact rebuildable transaction fence. */
function _ActiveProjection(computer: ConversationComputer, lease: ComputerLease): ConversationComputerActiveLeaseProjectionCommand
{
	return { computer: _ComputerScopeOf(computer), lease: { ..._LeaseScopeOf(lease), expiresAt: lease.expiresAt } };
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
