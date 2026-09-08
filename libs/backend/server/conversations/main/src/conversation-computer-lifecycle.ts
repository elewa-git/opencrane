import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import type { AgentSandboxClaimReleaseCommand } from "@opencrane/backend/server/infra/agent-sandbox";

import { _DeterministicUuid } from "./agent-session-identifiers";
import type { ConversationComputerActivity, ConversationComputerActivityReader } from "./conversation-computer-activity.types";
import type { ConversationComputerAttemptActivity, ConversationComputerCheckpointStore, ConversationComputerIdlePolicy, ConversationComputerLeaseProjectionCommand, ConversationComputerLifecycleCommand, ConversationComputerLifecycleOutcome, ConversationComputerSandboxClaims } from "./conversation-computer-lifecycle.types";
import { _ComputerScopeOf, _LeaseScopeOf, type ConversationComputerHistory, type CurrentConversationComputer } from "./conversation-computers";

/** Checks that the three policy durations are positive, increasing where required, and safe integers. */
export function _ValidateConversationComputerIdlePolicy(policy: ConversationComputerIdlePolicy): void
{
	if (!Number.isSafeInteger(policy.staleAfterMilliseconds) || !Number.isSafeInteger(policy.retireAfterMilliseconds) || !Number.isSafeInteger(policy.leaseTtlMilliseconds) || policy.staleAfterMilliseconds <= 0 || policy.retireAfterMilliseconds <= policy.staleAfterMilliseconds || policy.leaseTtlMilliseconds <= 0)
		throw new Error("Conversation computer idle policy requires increasing positive deadlines and a positive lease lifetime");
}

/**
 * Returns how long the lease has been idle, measured from the newest turn activity.
 *
 * A computer with an unsettled turn is never idle. Without any turn, the last durable computer
 * change stands in for activity so a freshly activated computer still cools on schedule.
 * @param computer - Current canonical computer snapshot.
 * @param activity - Newest turn activity for the current lease, or null without turns.
 * @param now - Server clock.
 */
export function _ConversationComputerIdleMilliseconds(computer: ConversationComputer, activity: ConversationComputerActivity | null, now: Date): number
{
	if (activity?.busy)
		return 0;
	const lastActivity = Math.max(Date.parse(computer.updatedAt), activity?.lastActivityAt.getTime() ?? 0);
	return Math.max(0, now.getTime() - lastActivity);
}

/** Returns true once less than half of the lease lifetime remains, or the claim lags the lease. */
export function _ConversationComputerRenewalDue(lease: ComputerLease, claimShutdownTime: string | null, policy: ConversationComputerIdlePolicy, now: Date): boolean
{
	if (Date.parse(lease.expiresAt) - now.getTime() <= policy.leaseTtlMilliseconds / 2)
		return true;
	// The claim adapter drops fractional seconds when it writes the Kubernetes shutdown time.
	return claimShutdownTime !== null && Math.floor(Date.parse(claimShutdownTime) / 1000) < Math.floor(Date.parse(lease.expiresAt) / 1000);
}

/**
 * Reconstructs lifecycle from Kurrent timestamps, turn activity, and the Agent Sandbox claim.
 *
 * Each pass first records a lost lease when its expiry passed or its claim disappeared, then either
 * renews a lease that is still in use or moves an idle computer through cooling, checkpoint, and
 * release. Every write is fenced by the observed stream revision.
 */
export class ConversationComputerLifecycleAuthority
{
	public constructor(private readonly computers: ConversationComputerHistory, private readonly checkpoints: ConversationComputerCheckpointStore, private readonly attempts: ConversationComputerAttemptActivity, private readonly claims: ConversationComputerSandboxClaims, private readonly activity: ConversationComputerActivityReader, private readonly namespace: string, private readonly policy: ConversationComputerIdlePolicy)
	{
		_ValidateConversationComputerIdlePolicy(policy);
	}

	/** Applies loss, renewal, the five-minute stale, and the twenty-minute checkpoint-and-release boundaries. */
	public async reconcile(command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		if (Number.isNaN(command.now.getTime()))
			throw new Error("Conversation computer lifecycle requires a valid server time");
		const current = await this.computers.load(command);
		if (current === null || current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.RecoveryRequired || current.computer.state === ConversationComputerStates.Retired)
			return "terminal";
		if (current.lease !== null && current.computer.state === ConversationComputerStates.Cooling && current.lease.state === ComputerLeaseStates.Released)
			return this._finishRelease(current, current.lease, command);
		if (current.lease === null || current.lease.state === ComputerLeaseStates.Released || current.lease.state === ComputerLeaseStates.Lost)
			return "current";
		const lease = current.lease;

		// 1. Record a lease whose realization can no longer report work before anything trusts it.
		const expired = Date.parse(lease.expiresAt) <= command.now.getTime();
		const claim = expired ? null : await this.claims.inspect(this._claimCommand(current.computer, lease));
		if (expired || (lease.state === ComputerLeaseStates.Active && claim === null))
			return this._markLost(current, lease, command);
		if (lease.state !== ComputerLeaseStates.Active)
			return "current";

		// 2. Measure idleness from turn activity, and retire a cooling computer before any renewal.
		const activity = await this.activity.lastActivity({ siloId: current.computer.siloId, computerId: current.computer.id, lease: _LeaseScopeOf(lease) });
		const idleMilliseconds = _ConversationComputerIdleMilliseconds(current.computer, activity, command.now);
		if (current.computer.state === ConversationComputerStates.Cooling && idleMilliseconds >= this.policy.retireAfterMilliseconds)
			return this._checkpointAndRelease(current, lease, command);
		if (_ConversationComputerRenewalDue(lease, claim?.shutdownTime ?? null, this.policy, command.now))
			return this._renew(current, lease, command);
		if (idleMilliseconds < this.policy.staleAfterMilliseconds)
			return "current";
		if (current.computer.state === ConversationComputerStates.Warm)
		{
			await this.computers.append({ expectedRevision: current.revision, eventId: command.eventId, computer: { ...current.computer, state: ConversationComputerStates.Cooling }, lease });
			return "cooling";
		}
		return "cooling";
	}

	/** Move the shutdown time on the claim, then in canonical history, then in the projection. */
	private async _renew(current: CurrentConversationComputer, lease: ComputerLease, command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		const expiresAt = new Date(command.now.getTime() + this.policy.leaseTtlMilliseconds).toISOString();
		if (await this.claims.renew({ ...this._claimCommand(current.computer, lease), expiresAt }) === "absent")
			return this._markLost(current, lease, command);
		await this.computers.append({ expectedRevision: current.revision, eventId: _DeterministicUuid("computer-lease-renewed", lease.id, current.revision.toString()), computer: current.computer, lease: { ...lease, expiresAt } });
		const projection = _LeaseProjectionCommand(current.computer, lease);
		if (!await this.attempts.extendActiveLease({ computer: projection.computer, lease: { ...projection.lease, expiresAt } }))
			throw new Error("Conversation computer active lease projection changed before renewal completion");
		return "renewed";
	}

	/** Release the projection fence, delete any leftover claim, and record the lease as lost. */
	private async _markLost(current: CurrentConversationComputer, lease: ComputerLease, command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		if (!await this.attempts.clearActiveLease(_LeaseProjectionCommand(current.computer, lease)))
			return "active_attempt";
		await this.claims.release(this._claimCommand(current.computer, lease));
		const lostAt = command.now.toISOString();
		await this.computers.append({ expectedRevision: current.revision, eventId: _DeterministicUuid("computer-lease-lost", lease.id, current.revision.toString()), computer: { ...current.computer, state: ConversationComputerStates.Cold, updatedAt: lostAt }, lease: { ...lease, state: ComputerLeaseStates.Lost, releasedAt: lostAt } });
		return "lost";
	}

	/** Capture the workspace, record the release, delete the claim, and cool to zero. */
	private async _checkpointAndRelease(current: CurrentConversationComputer, lease: ComputerLease, command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		const checkpoint = await this.checkpoints.capture(current.computer, lease);
		const releasedAt = command.now.toISOString();
		if (!await this.attempts.clearActiveLease(_LeaseProjectionCommand(current.computer, lease)))
			return "active_attempt";
		await this.computers.append({ expectedRevision: current.revision, eventId: command.eventId, computer: { ...current.computer, workspaceCheckpoint: checkpoint }, lease: { ...lease, state: ComputerLeaseStates.Released, releasedAt } });
		const released = await this.computers.load(command);
		if (released === null || released.lease?.state !== ComputerLeaseStates.Released)
			throw new Error("Conversation computer checkpoint release history is unavailable");
		return this._coolToZero(released, released.lease, command);
	}

	/** Resume a durable release whose claim deletion or cold record did not complete. */
	private async _finishRelease(current: CurrentConversationComputer, lease: ComputerLease, command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		if (!await this.attempts.clearActiveLease(_LeaseProjectionCommand(current.computer, lease)))
			throw new Error("Conversation computer active lease projection changed before release completion");
		return this._coolToZero(current, lease, command);
	}

	/** Delete the released claim and record the cold computer after the release intent is durable. */
	private async _coolToZero(current: CurrentConversationComputer, lease: ComputerLease, command: ConversationComputerLifecycleCommand): Promise<ConversationComputerLifecycleOutcome>
	{
		await this.claims.release(this._claimCommand(current.computer, lease));
		await this.computers.append({ expectedRevision: current.revision, eventId: _CompletionEventId(command.eventId), computer: { ...current.computer, state: ConversationComputerStates.Cold, updatedAt: command.now.toISOString() }, lease });
		return "retired_to_checkpoint";
	}

	/** Bind one claim operation to the exact deterministic claim of the lease. */
	private _claimCommand(computer: ConversationComputer, lease: ComputerLease): AgentSandboxClaimReleaseCommand
	{
		return { namespace: this.namespace, claimId: lease.sandboxClaimId, computerId: computer.id, leaseId: lease.id, generation: lease.generation };
	}
}

/** Bind a projection change to every canonical computer and lease coordinate. */
function _LeaseProjectionCommand(computer: ConversationComputer, lease: ComputerLease): ConversationComputerLeaseProjectionCommand
{
	return { computer: _ComputerScopeOf(computer), lease: _LeaseScopeOf(lease) };
}

/** Derive a distinct deterministic completion event after the release intent is durable. */
function _CompletionEventId(eventId: string): string
{
	const chars = eventId.replaceAll("-", "").split("");
	chars[31] = chars[31] === "0" ? "1" : "0";
	const hex = chars.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
