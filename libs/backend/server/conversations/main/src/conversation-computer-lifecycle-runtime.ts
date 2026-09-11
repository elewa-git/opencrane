import { Readable } from "node:stream";

import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerActivityReader } from "./conversation-computer-activity.types";
import type { ConversationComputerCheckpointRestoreCommand, ConversationComputerCheckpointSandbox } from "./conversation-computer-checkpoint.types";
import { _ConversationComputerIdleMilliseconds, _ConversationComputerRenewalDue, _ValidateConversationComputerIdlePolicy } from "./conversation-computer-lifecycle";
import type { ConversationComputerLifecycleCandidate, ConversationComputerLifecycleCandidatePage } from "./conversation-computer-lifecycle-scheduler.types";
import type { ConversationComputerCheckpointCurrent, ConversationComputerCheckpointFenceDependencies, ConversationComputerLifecycleLogger, ConversationComputerLifecycleProjection } from "./conversation-computer-lifecycle-runtime.types";
import type { ConversationComputerIdlePolicy } from "./conversation-computer-lifecycle.types";
import type { ConversationComputerRealizer } from "./conversation-computer-realization.types";
import { _LeaseScopeOf, type ConversationComputerHistory, type CurrentConversationComputer } from "./conversation-computers";
import type { ConversationComputerLifecycleScheduler } from "./conversation-computer-lifecycle-scheduler";
import type { ConversationComputerReviewCredentialDeriver } from "./review/conversation-computer-review.types";

/** Streams workspace checkpoints only to the current cluster-local sandbox Service. */
export class HttpConversationComputerCheckpointSandbox implements ConversationComputerCheckpointSandbox
{
	/** Derives the per-lease review credential the Pod accepts; the lease id itself is only a name. */
	public constructor(private readonly credentials: ConversationComputerReviewCredentialDeriver) {}

	/** Capture one bounded response through the derived review credential. */
	public async capture(computer: Parameters<ConversationComputerCheckpointSandbox["capture"]>[0], lease: Parameters<ConversationComputerCheckpointSandbox["capture"]>[1]): Promise<AsyncIterable<Uint8Array>>
	{
		const response = await fetch(_SandboxUrl(_SandboxService(lease), "/v1/checkpoints/capture"), { headers: { authorization: `Bearer ${this._Credential(computer, lease)}` }, signal: AbortSignal.timeout(30_000) });
		if (!response.ok || response.body === null || response.headers.get("content-type") !== "application/vnd.opencrane.workspace-tar+gzip")
			throw new Error(`Conversation computer checkpoint capture failed with ${response.status}`);
		return _WebBytes(response.body);
	}

	/** Restore one verified stream through the derived review credential. */
	public async restore(computer: Parameters<ConversationComputerCheckpointSandbox["restore"]>[0], lease: Parameters<ConversationComputerCheckpointSandbox["restore"]>[1], bytes: AsyncIterable<Uint8Array>): Promise<void>
	{
		const response = await fetch(_SandboxUrl(_SandboxService(lease), "/v1/checkpoints/restore"), { method: "POST", headers: { authorization: `Bearer ${this._Credential(computer, lease)}`, "content-type": "application/vnd.opencrane.workspace-tar+gzip" }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half", signal: AbortSignal.timeout(30_000) } as RequestInit);
		if (!response.ok)
			throw new Error(`Conversation computer checkpoint restore failed with ${response.status}`);
	}

	/** Bind the bearer to the exact computer, generation and lease the Pod was admitted with, under every keyring key. */
	private _Credential(computer: Parameters<ConversationComputerCheckpointSandbox["capture"]>[0], lease: Parameters<ConversationComputerCheckpointSandbox["capture"]>[1]): string
	{
		return this.credentials.bearer({ siloId: computer.siloId, computerId: computer.id, lease: _LeaseScopeOf(lease) });
	}
}

/** Rechecks relational, Kurrent, SandboxClaim, and TokenReviewed Pod coordinates together. */
export class ConversationComputerCheckpointFenceAdapter
{
	/** Bind the four independent evidence sources used by checkpoint restoration. */
	public constructor(private readonly dependencies: ConversationComputerCheckpointFenceDependencies) {}

	/** Return the current active lease only after the exact Pod binding verifies. */
	public async assertCurrent(command: ConversationComputerCheckpointRestoreCommand): Promise<ConversationComputerCheckpointCurrent>
	{
		const coordinates = await this.dependencies.projections.resolve(command.siloId, command.computerId);
		if (coordinates === null)
			throw new Error("Conversation computer checkpoint projection is unavailable");
		const current = await this.dependencies.history.load(coordinates);
		if (current === null || current.lease === null || current.lease.state !== ComputerLeaseStates.Active || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration || current.lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox || current.lease.realization.sandboxId === null)
			throw new Error("Conversation computer checkpoint requires the current lease generation");
		const profile = this.dependencies.profile;
		const workload = { namespace: profile.namespace, serviceAccountName: profile.serviceAccountName, podUid: command.podUid, subject: `system:serviceaccount:${profile.namespace}:${profile.serviceAccountName}` };
		if (!await this.dependencies.pods.verify({ computerId: command.computerId, lease: command.lease, realization: current.lease.realization, workload }))
			throw new Error("Conversation computer checkpoint Pod is not lease-bound");
		return { computer: current.computer, lease: current.lease };
	}
}

/**
 * Filters rebuildable relational coordinates through authoritative Kurrent lifecycle deadlines.
 *
 * A computer is due when its lease expired, its process disappeared, its lease needs renewal, or its
 * newest turn activity crossed the stale or retire boundary. The reconciler re-reads history and
 * decides the actual transition.
 */
export class ConversationComputerLifecycleDueEnumerator
{
	/** Binds a silo projection to Kurrent history, turn activity, process status, and the idle policy. */
	public constructor(private readonly projections: ConversationComputerLifecycleProjection, private readonly history: ConversationComputerHistory, private readonly activity: ConversationComputerActivityReader, private readonly realizer: Pick<ConversationComputerRealizer, "inspect">, private readonly siloId: string, private readonly policy: ConversationComputerIdlePolicy)
	{
		_ValidateConversationComputerIdlePolicy(policy);
	}

	/** Return due nonterminal computers only after validating their current history snapshots. */
	public async enumerateDue(now: Date, limit: number, afterConversationId: string | null): Promise<ConversationComputerLifecycleCandidatePage>
	{
		const page = await this.projections.enumerate(this.siloId, afterConversationId, limit);
		const candidates: ConversationComputerLifecycleCandidate[] = [];
		for (const coordinate of page.items)
		{
			const current = await this.history.load(coordinate);
			if (current === null || current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.RecoveryRequired || current.computer.state === ConversationComputerStates.Retired)
				continue;
			const deadline = await this._deadline(current, now);
			if (deadline !== null && deadline <= now)
				candidates.push({ ...coordinate, state: current.computer.state, deadline });
		}
		return { items: candidates, nextCursor: page.nextCursor };
	}

	/** Compute the earliest instant at which this computer needs a lifecycle decision. */
	private async _deadline(current: CurrentConversationComputer, now: Date): Promise<Date | null>
	{
		const lease = current.lease;
		if (lease === null || lease.state === ComputerLeaseStates.Lost)
			return null;
		if (lease.state === ComputerLeaseStates.Released)
			return new Date(lease.releasedAt ?? current.computer.updatedAt);
		const expiresAt = new Date(lease.expiresAt);
		if (lease.state === ComputerLeaseStates.Claimed || expiresAt <= now)
			return expiresAt;
		const claim = await this.realizer.inspect({ computerId: current.computer.id, lease: { leaseId: lease.id, leaseGeneration: lease.generation, realization: lease.realization } });
		if (claim === null || _ConversationComputerRenewalDue(lease, claim.shutdownTime, this.policy, now))
			return now;
		const activity = await this.activity.lastActivity({ siloId: current.computer.siloId, computerId: current.computer.id, lease: _LeaseScopeOf(lease) });
		if (activity?.busy)
			return expiresAt;
		const delay = current.computer.state === ConversationComputerStates.Warm ? this.policy.staleAfterMilliseconds : this.policy.retireAfterMilliseconds;
		const idleDeadline = new Date(now.getTime() - _ConversationComputerIdleMilliseconds(current.computer, activity, now) + delay);
		return idleDeadline < expiresAt ? idleDeadline : expiresAt;
	}
}

/** Read a checkpoint endpoint only from a production Agent Sandbox realization. */
function _SandboxService(lease: import("@opencrane/contracts").ComputerLease): string | null
{
	if (lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox)
		throw new Error("Host development conversation computers do not support workspace checkpoints");
	return lease.realization.serviceFQDN;
}

/** Owns the bounded timer that drives computer lifecycle reconciliation. */
export class ConversationComputerLifecycleWorker
{
	/** Process timer stopped during coordinated application shutdown. */
	private readonly timer: NodeJS.Timeout;

	/** Start one non-blocking bounded scheduler cadence. */
	public constructor(scheduler: ConversationComputerLifecycleScheduler, logger: ConversationComputerLifecycleLogger, intervalMilliseconds = 30_000)
	{
		this.timer = setInterval(function _ReconcileComputers() { void scheduler.reconcileDue(new Date()).catch(function _LogFailure(error: unknown) { logger.error({ err: error }, "conversation computer lifecycle pass failed"); }); }, intervalMilliseconds);
		this.timer.unref();
	}

	/** Stop future lifecycle passes during coordinated shutdown. */
	public async stop(): Promise<void> { clearInterval(this.timer); }
}

/** Restrict checkpoint traffic to a controller-reported cluster-local Service. */
function _SandboxUrl(serviceFQDN: string | null, path: string): string
{
	if (serviceFQDN === null || !/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(serviceFQDN) || !serviceFQDN.endsWith(".svc.cluster.local"))
		throw new Error("Conversation computer checkpoint requires a valid sandbox Service FQDN");
	return `http://${serviceFQDN}:8090${path}`;
}

/** Adapt one fetch body to the checkpoint streaming contract. */
async function* _WebBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array>
{
	for await (const chunk of Readable.fromWeb(body as never))
		yield chunk;
}
