import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import type { AgentSandboxPodBinding } from "@opencrane/backend/server/infra/agent-sandbox";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerPendingTurnCompiler, ConversationComputerPodLeaseCommand, ConversationComputerTurnCandidate, ConversationComputerTurnCandidateResolver, ConversationComputerTurnExecution, ConversationComputerTurnHistoryAnchor, ConversationComputerTurnProjectionRepository, ConversationComputerTurnWorkflowCommand, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Resolves a pending turn only after exact silo, lease, generation, claim and Pod checks. */
export class ActiveConversationComputerTurnCandidateResolver implements ConversationComputerTurnCandidateResolver
{
	public constructor(private readonly siloId: string, private readonly projections: ConversationComputerTurnProjectionRepository, private readonly computers: ConversationComputerHistory, private readonly pods: AgentSandboxPodBinding, private readonly compiler: ConversationComputerPendingTurnCompiler, private readonly sandbox: { readonly namespace: string; readonly serviceAccountName: string }) {}

	/** Check the lease and Pod binding with the same rules as resolve while admitting no run. */
	public async admit(command: ConversationComputerPodLeaseCommand): Promise<void>
	{
		await this._Admit(command);
	}

	/** Resolve one currently active generation and compile its pending input. */
	public async resolve(command: ConversationComputerPodLeaseCommand): Promise<ConversationComputerTurnCandidate | null>
	{
		const { projection, current, lease } = await this._Admit(command);
		return this._Compile(command.computerId, projection, current, lease);
	}

	/** Resolve the current Pod from the SandboxClaim instead of accepting a Pod request as authority. */
	public async resolveForWorkflow(command: ConversationComputerTurnWorkflowCommand): Promise<ConversationComputerTurnExecution | null>
	{
		const { projection, current, lease } = await this._CurrentLease(command);
		const workload = await this._ResolveWorkload(command.computerId, lease);
		const candidate = await this._Compile(command.computerId, projection, current, lease);
		return candidate === null ? null : { candidate, workload };
	}

	/** Compile the pending input after the caller has proved the current lease and Pod. */
	private async _Compile(computerId: string, projection: { readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string }, current: { readonly lease: { readonly expiresAt: string } }, lease: { readonly leaseId: string; readonly leaseGeneration: number; readonly sandboxClaimId: string }, anchor?: ConversationComputerTurnHistoryAnchor): Promise<ConversationComputerTurnCandidate | null>
	{
		const command = { computer: { siloId: this.siloId, computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId, lease };
		const candidate = anchor === undefined ? await this.compiler.compile(command) : await this.compiler.compile(command, anchor);
		if (candidate === null)
			return null;
		const expiresAt = Math.min(Date.parse(current.lease.expiresAt), Date.parse(candidate.credentialExpiresAt));
		const remainingLeaseSeconds = Math.floor((expiresAt - Date.now()) / 1_000);
		if (!Number.isFinite(expiresAt) || remainingLeaseSeconds < 1)
			throw new Error("Conversation computer turn requires enough remaining lease time");
		return { ...candidate, credentialLifetimeSeconds: Math.min(candidate.credentialLifetimeSeconds, remainingLeaseSeconds), credentialExpiresAt: new Date(expiresAt).toISOString() };
	}

	/** Load the projection and current history, then require the exact active lease and its bound Pod. */
	private async _Admit(command: ConversationComputerPodLeaseCommand)
	{
		const { projection, current, lease } = await this._CurrentLease(command);
		if (!await this.pods.verify({ computerId: command.computerId, lease, workload: command.workload }))
			throw new Error("Conversation computer review caller is not the lease-bound Sandbox Pod");
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Load the canonical active generation before either Pod or workflow identity is checked. */
	private async _CurrentLease(command: Pick<ConversationComputerTurnWorkflowCommand, "computerId" | "lease">)
	{
		const projection = await this.projections.resolve(this.siloId, command.computerId);
		if (projection === null)
			throw new Error("Conversation computer cannot resolve a computer in the server silo");
		const current = await this.computers.load({ computer: { siloId: this.siloId, computerId: command.computerId, conversationId: projection.conversationId, agentIdentityId: projection.agentIdentityId }, profileRevisionId: projection.profileRevisionId });
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease?.state !== ComputerLeaseStates.Active || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration || current.computer.leaseGeneration !== command.lease.leaseGeneration || current.lease.sandboxId === null || Date.parse(current.lease.expiresAt) <= Date.now())
			throw new Error("Conversation computer requires the current active lease generation");
		const lease = { leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration, sandboxClaimId: `${command.computerId}-g${command.lease.leaseGeneration}` };
		return { projection, current: { ...current, lease: current.lease }, lease };
	}

	/** Recheck lease, generation, Pod binding and the exact conversation revision before output. */
	public async assertCurrent(turn: FrozenConversationComputerTurn, workload: ConversationComputerPodLeaseCommand["workload"]): Promise<ConversationComputerTurnCandidate>
	{
		if (turn.siloId !== this.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		const { projection, current, lease } = await this._Admit({ computerId: turn.computerId, lease: turn.lease, workload });
		const candidate = await this._Compile(turn.computerId, projection, current, lease, { expectedRevision: turn.binding.expectedRevision, latestPendingEntryId: turn.latestPendingEntryId });
		if (candidate === null || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new Error("Conversation computer output requires the original conversation history");
		return candidate;
	}

	/** Resolve the live Pod from release-fixed coordinates after current lease validation. */
	private async _ResolveWorkload(computerId: string, lease: { readonly leaseId: string; readonly leaseGeneration: number; readonly sandboxClaimId: string })
	{
		const workload = await this.pods.resolve({ computerId, lease, namespace: this.sandbox.namespace, serviceAccountName: this.sandbox.serviceAccountName });
		if (workload === null)
			throw new Error("Conversation computer workflow requires the lease-bound Sandbox Pod");
		return workload;
	}

	/** Recheck the exact frozen input and resolve the live Pod before a server-owned effect. */
	public async assertCurrentForWorkflow(turn: FrozenConversationComputerTurn): Promise<ConversationComputerTurnExecution>
	{
		const { projection, current, lease } = await this._CurrentLease({ computerId: turn.computerId, lease: turn.lease });
		const workload = await this._ResolveWorkload(turn.computerId, lease);
		const candidate = await this._Compile(turn.computerId, projection, current, lease, { expectedRevision: turn.binding.expectedRevision, latestPendingEntryId: turn.latestPendingEntryId });
		if (candidate === null || candidate.latestPendingEntryId !== turn.latestPendingEntryId || candidate.compiledInput.digest !== turn.compile.digest || candidate.modelAlias !== turn.modelAlias)
			throw new Error("Conversation computer output requires restart after conversation history changed");
		return { candidate, workload };
	}

	/** Recheck the live lease and Pod without recompiling input already consumed by a saved output. */
	public async assertLeaseForWorkflow(turn: FrozenConversationComputerTurn): Promise<RuntimeWorkloadIdentity>
	{
		if (turn.siloId !== this.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		const { lease } = await this._CurrentLease({ computerId: turn.computerId, lease: turn.lease });
		return this._ResolveWorkload(turn.computerId, lease);
	}
}
