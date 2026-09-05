import { Readable } from "node:stream";

import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import type { ConversationComputerCheckpointRestoreCommand, ConversationComputerCheckpointSandbox } from "./conversation-computer-checkpoint.types";
import type { ConversationComputerLifecycleCandidate } from "./conversation-computer-lifecycle-scheduler.types";
import type { ConversationComputerCheckpointCurrent, ConversationComputerCheckpointFenceDependencies, ConversationComputerLifecycleLogger, ConversationComputerLifecycleProjection } from "./conversation-computer-lifecycle-runtime.types";
import type { ConversationComputerHistory } from "./conversation-computers";
import type { ConversationComputerLifecycleScheduler } from "./conversation-computer-lifecycle-scheduler";

/** Streams workspace checkpoints only to the current cluster-local sandbox Service. */
export class HttpConversationComputerCheckpointSandbox implements ConversationComputerCheckpointSandbox
{
	/** Capture one bounded response through the lease-local bearer credential. */
	public async capture(_computer: Parameters<ConversationComputerCheckpointSandbox["capture"]>[0], lease: Parameters<ConversationComputerCheckpointSandbox["capture"]>[1]): Promise<AsyncIterable<Uint8Array>>
	{
		const response = await fetch(_SandboxUrl(lease.serviceFQDN, "/v1/checkpoints/capture"), { headers: { authorization: `Bearer ${lease.id}` }, signal: AbortSignal.timeout(30_000) });
		if (!response.ok || response.body === null || response.headers.get("content-type") !== "application/vnd.opencrane.workspace-tar+gzip")
			throw new Error(`Conversation computer checkpoint capture failed with ${response.status}`);
		return _WebBytes(response.body);
	}

	/** Restore one verified stream through the lease-local bearer credential. */
	public async restore(_computer: Parameters<ConversationComputerCheckpointSandbox["restore"]>[0], lease: Parameters<ConversationComputerCheckpointSandbox["restore"]>[1], bytes: AsyncIterable<Uint8Array>): Promise<void>
	{
		const response = await fetch(_SandboxUrl(lease.serviceFQDN, "/v1/checkpoints/restore"), { method: "POST", headers: { authorization: `Bearer ${lease.id}`, "content-type": "application/vnd.opencrane.workspace-tar+gzip" }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half", signal: AbortSignal.timeout(30_000) } as RequestInit);
		if (!response.ok)
			throw new Error(`Conversation computer checkpoint restore failed with ${response.status}`);
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
		if (current === null || current.lease === null || current.lease.state !== ComputerLeaseStates.Active || current.lease.id !== command.leaseId || current.lease.generation !== command.generation || current.lease.sandboxId === null)
			throw new Error("Conversation computer checkpoint requires the current lease generation");
		const profile = this.dependencies.profile;
		const workload = { namespace: profile.namespace, serviceAccountName: profile.serviceAccountName, podUid: command.podUid, subject: `system:serviceaccount:${profile.namespace}:${profile.serviceAccountName}` };
		if (!await this.dependencies.pods.verify({ computerId: command.computerId, generation: command.generation, leaseId: command.leaseId, sandboxClaimId: current.lease.sandboxClaimId, workload }))
			throw new Error("Conversation computer checkpoint Pod is not lease-bound");
		return { computer: current.computer, lease: current.lease };
	}
}

/** Filters rebuildable relational coordinates through canonical Kurrent lifecycle deadlines. */
export class ConversationComputerLifecycleDueEnumerator
{
	/** Bind a silo projection to canonical history and the two idle deadlines. */
	public constructor(private readonly projections: ConversationComputerLifecycleProjection, private readonly history: ConversationComputerHistory, private readonly siloId: string, private readonly staleAfterMilliseconds: number, private readonly retireAfterMilliseconds: number) {}

	/** Return due nonterminal computers only after validating their current history snapshots. */
	public async enumerateDue(now: Date, limit: number): Promise<readonly ConversationComputerLifecycleCandidate[]>
	{
		const coordinates = await this.projections.enumerate(this.siloId, limit);
		const candidates: ConversationComputerLifecycleCandidate[] = [];
		for (const coordinate of coordinates)
		{
			const current = await this.history.load(coordinate);
			if (current === null || current.computer.state === ConversationComputerStates.Cold || current.computer.state === ConversationComputerStates.RecoveryRequired || current.computer.state === ConversationComputerStates.Retired)
				continue;
			const delay = current.computer.state === ConversationComputerStates.Warm ? this.staleAfterMilliseconds : this.retireAfterMilliseconds;
			const deadline = new Date(Date.parse(current.computer.updatedAt) + delay);
			if (deadline <= now)
				candidates.push({ ...coordinate, state: current.computer.state, deadline });
		}
		return candidates;
	}
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
