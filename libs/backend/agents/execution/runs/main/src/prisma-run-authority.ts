import { AgentRunState, AgentServiceState as PrismaAgentServiceState, OrgMemberStatus, RunOutboxEventKind, type Prisma } from "@prisma/client";

import type { AgentRun, AgentRunState as DomainAgentRunState, AgentRunTerminalReason, AgentRunTrigger, AgentServiceState as DomainAgentServiceState } from "@opencrane/models/agents";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWorkflowTaskAdmissionUnitOfWork } from "./prisma-agent-run-workflow-task-admission-unit-of-work";
import type { AgentRunAuthoritySnapshot, AgentRunRetryTransactionRepository, AtomicRunAttemptResult, AtomicStartNextRunAttemptCommand, StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";

/** Maps a Prisma AgentRun lifecycle identifier to the target contract value. */
function _runState(value: string): DomainAgentRunState
{
	switch (value)
	{
		case "Accepted": return "accepted";
		case "Queued": return "queued";
		case "Assigned": return "assigned";
		case "Running": return "running";
		case "WaitingForInput": return "waiting_for_input";
		case "Cancelling": return "cancelling";
		case "Completed": return "completed";
		case "Failed": return "failed";
		case "Cancelled": return "cancelled";
		default: throw new Error(`unknown AgentRun state: ${value}`);
	}
}

/** Maps a Prisma run trigger identifier to the target contract value. */
function _runTrigger(value: string): AgentRunTrigger
{
	if (value === "Interactive") return "interactive";
	if (value === "Schedule") return "schedule";
	if (value === "ManagedInvocation") return "managed_invocation";
	throw new Error(`unknown AgentRun trigger: ${value}`);
}

/** Maps a nullable Prisma terminal reason identifier to the target contract value. */
function _terminalReason(value: string | null): AgentRunTerminalReason | null
{
	if (value === null) return null;
	switch (value)
	{
		case "Success": return "success";
		case "UserCancelled": return "user_cancelled";
		case "PolicyDenied": return "policy_denied";
		case "BudgetExhausted": return "budget_exhausted";
		case "RuntimeFailure": return "runtime_failure";
		case "InvalidInput": return "invalid_input";
		default: throw new Error(`unknown AgentRun terminal reason: ${value}`);
	}
}

/** Maps a nullable Prisma AgentService state identifier to the target contract value. */
function _serviceState(value: string | null): DomainAgentServiceState | null
{
	if (value === null) return null;
	switch (value)
	{
		case "Draft": return "draft";
		case "Active": return "active";
		case "Paused": return "paused";
		case "Retired": return "retired";
		default: throw new Error(`unknown AgentService state: ${value}`);
	}
}

/** Maps one Prisma run row to the dependency-light target contract. */
function _mapRun(row: { id: string; siloId: string; agentServiceId: string; agentRevisionId: string; conversationId: string | null; trigger: string; delegatedUserId: string | null; requestIdempotencyKey: string; rootRunId: string; parentRunId: string | null; attempt: number; state: string; effectiveContractDigest: string; inputSnapshotDigest: string; acceptedAt: Date; startedAt: Date | null; finishedAt: Date | null; terminalReason: string | null }): AgentRun
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		conversationId: row.conversationId,
		trigger: _runTrigger(row.trigger),
		delegatedUserId: row.delegatedUserId,
		requestIdempotencyKey: row.requestIdempotencyKey,
		lineage: { rootRunId: row.rootRunId, parentRunId: row.parentRunId },
		attempt: row.attempt,
		state: _runState(row.state),
		effectiveContractDigest: row.effectiveContractDigest,
		inputSnapshotDigest: row.inputSnapshotDigest,
		acceptedAt: row.acceptedAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		finishedAt: row.finishedAt?.toISOString() ?? null,
		terminalReason: _terminalReason(row.terminalReason),
	};
}

/**
 * Reads and retries one AgentRun through a transaction supplied by the retry unit of work.
 *
 * This adapter cannot open or retry a transaction. `PrismaAgentRunRetryUnitOfWork` constructs a new
 * instance for every complete transaction attempt, which prevents a repository from carrying state
 * across a rollback.
 *
 * The conditional `updateMany` in `startNextAttemptAtomically` repeats every observed authority
 * fact on the write. Only one concurrent retry can match those conditions and increment the run.
 *
 * Called by: `PrismaAgentRunRetryUnitOfWork`.
 *
 * @implements AgentRunRetryTransactionRepository
 * @see docs/agents/prisma.md, "Runtime ORM ownership", for the repository and transaction rules this
 * adapter sits under.
 */
export class PrismaAgentRunAuthorityRepository implements AgentRunRetryTransactionRepository
{
	/** Transaction opened by the retry unit of work. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Guarded engine that persists the controller-owned retry task. */
	private readonly _workflow: Pick<IWorkflowEngine, "spawn">;

	/**
	 * Creates the adapter around one transaction attempt.
	 * @param transaction - Transaction that owns the retry and task records.
	 * @param workflow - Guarded engine that saves the controller-owned task receipt.
	 */
	constructor(transaction: Prisma.TransactionClient, workflow: Pick<IWorkflowEngine, "spawn">)
	{
		this._transaction = transaction;
		this._workflow = workflow;
	}

	/**
	 * Reads the run and the AgentService it names in one transaction.
	 *
	 * Both rows are read in the same transaction so they describe one moment; two separate queries
	 * could report a run and a service that were never in those states at the same time, and the
	 * retry decision compares facts from both.
	 *
	 * @param runId - The run to read.
	 * @returns The snapshot, or null when no run has that id. The three service fields are null when
	 * the referenced AgentService no longer exists, which the domain treats as unusable.
	 * @throws When a stored enum value is not one the mapping functions know, or when the database is
	 * unreachable.
	 */
	async getRunAuthority(runId: string): Promise<AgentRunAuthoritySnapshot | null>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { id: runId } });
		if (run === null) return null;
		const service = await this._transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
		return {
			run: _mapRun(run),
			agentServiceSiloId: service?.siloId ?? null,
			agentServiceState: _serviceState(service?.state ?? null),
			activeAgentRevisionId: service?.activeRevisionId ?? null,
		};
	}

	/**
	 * Raises the attempt counter and writes the event that gets the new attempt dispatched, in one
	 * transaction.
	 *
	 * Authorisation is re-checked here rather than trusted from the HTTP layer, because a person can
	 * lose their org membership or be removed from the conversation between pressing retry and this
	 * write landing. "denies a retry before mutation when current participant authority is absent"
	 * asserts that the update is not even attempted in that case.
	 *
	 * The attempt row and its outbox event are written together so a retry cannot be recorded without
	 * anything picking it up, and cannot be dispatched twice: the event's idempotency key is
	 * `${runId}:attempt:${attempt}`, one per attempt, and its payload also records who asked and with
	 * which retry key. That stored payload is what lets a repeated request be recognised as the same
	 * retry instead of a new one.
	 *
	 * @param command - The retry, plus the run and service coordinates the domain observed.
	 * @returns One {@link AtomicRunAttemptResult}. `started` is the only value that wrote anything;
	 * `idempotent` means the attempt was already there and this call left the database alone.
	 * @throws When a stored enum value is unknown, or the transaction fails or is rolled back — in
	 * which case neither the attempt nor its event exists.
	 */
	async startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
	{
		const transaction = this._transaction;
		// 1. Check that the person asking is still an active org member and still in the conversation,
		// before reading or writing anything else. Both can be revoked after the request was sent, and
		// `accessEndedPosition: null` is what distinguishes a current participant from a removed one.
		const participant = await transaction.conversationParticipant.findFirst({ where: { conversationId: command.conversationId, userId: command.requestedBy, accessEndedPosition: null, conversation: { siloId: command.siloId } }, select: { conversationId: true } });
		const membership = await transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.requestedBy, status: OrgMemberStatus.Active }, select: { id: true } });
		if (participant === null || membership === null) return { status: "unauthorized" } as const;

		// 2. Read the run and service and answer the cases that need no write. A run already one
		// attempt ahead is checked against the stored outbox payload first: if that attempt was started
		// by this same person and retry key, this is a repeat and the answer is `idempotent` rather than
		// a conflict. That order matters — checking the attempt first would report a caller's own retry
		// as somebody else's change.
		const service = await transaction.agentService.findUnique({ where: { id: command.expectedAgentServiceId }, select: { id: true, siloId: true, state: true, activeRevisionId: true } });
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null) return { status: "not_found" } as const;
		if (run.siloId !== command.siloId || run.conversationId !== command.conversationId) return { status: "unauthorized" } as const;
		if (run.attempt === command.expectedAttempt + 1)
		{
			const event = await transaction.outboxEvent.findUnique({ where: { idempotencyKey: `${run.id}:attempt:${run.attempt}` }, select: { payload: true } });
			if (_RetryMatches(event?.payload, command)) return { status: "idempotent", run: _mapRun(run) } as const;
		}
		if (run.attempt !== command.expectedAttempt) return { status: "attempt_conflict", currentAttempt: run.attempt } as const;
		if (run.agentServiceId !== command.expectedAgentServiceId || service?.state !== PrismaAgentServiceState.Active || service.siloId !== command.expectedAgentServiceSiloId || service.activeRevisionId !== command.expectedActiveAgentRevisionId)
		{
			return { status: "agent_service_authority_conflict", currentAgentServiceState: _serviceState(service?.state ?? null), currentAgentServiceSiloId: service?.siloId ?? null, currentActiveAgentRevisionId: service?.activeRevisionId ?? null } as const;
		}

		// 3. Write the new attempt onto the same row, with every observed fact repeated as a condition
		// so the update applies to nothing if any of them changed since step 2. This one statement makes
		// the retry safe under concurrency. Only the fields that belong to an attempt are reset — cost,
		// timings, and terminal reason go back to null — while the id, conversation, service, and
		// revision stay, so the run keeps its identity and history rather than becoming a new run.
		// A count other than 1 means somebody else got there first, so the row is read again to say
		// which of the three things happened: the same retry replayed, a different attempt now, or the
		// service having changed underneath.
		const nextAttempt = command.expectedAttempt + 1;
		const changed = await transaction.agentRun.updateMany({
			where: { id: run.id, attempt: command.expectedAttempt, state: { in: [AgentRunState.Failed, AgentRunState.Cancelled] }, agentServiceId: command.expectedAgentServiceId, agentRevisionId: command.expectedActiveAgentRevisionId, siloId: command.expectedAgentServiceSiloId, service: { is: { state: PrismaAgentServiceState.Active, siloId: command.expectedAgentServiceSiloId, activeRevisionId: command.expectedActiveAgentRevisionId } } },
			data: { attempt: nextAttempt, state: AgentRunState.Accepted, acceptedAt: new Date(command.acceptedAt), startedAt: null, finishedAt: null, terminalReason: null, costAmount: null, costCurrency: null },
		});
		if (changed.count !== 1)
		{
			const current = await transaction.agentRun.findUnique({ where: { id: run.id } });
			if (current === null) return { status: "not_found" } as const;
			if (current.attempt === nextAttempt)
			{
				const event = await transaction.outboxEvent.findUnique({ where: { idempotencyKey: `${run.id}:attempt:${nextAttempt}` }, select: { payload: true } });
				if (_RetryMatches(event?.payload, command)) return { status: "idempotent", run: _mapRun(current) } as const;
			}
			if (current.attempt !== command.expectedAttempt) return { status: "attempt_conflict", currentAttempt: current.attempt } as const;
			const currentService = await transaction.agentService.findUnique({ where: { id: command.expectedAgentServiceId }, select: { siloId: true, state: true, activeRevisionId: true } });
			return { status: "agent_service_authority_conflict", currentAgentServiceState: _serviceState(currentService?.state ?? null), currentAgentServiceSiloId: currentService?.siloId ?? null, currentActiveAgentRevisionId: currentService?.activeRevisionId ?? null } as const;
		}
		const updated = await transaction.agentRun.findUnique({ where: { id: run.id } });
		if (updated === null) return { status: "not_found" } as const;

		// 4. Admit the controller task before retaining the temporary legacy event. A task failure rolls
		// the attempt back, so old and new dispatch records never disagree about whether it exists.
		const admission = new PrismaAgentRunWorkflowTaskAdmissionUnitOfWork(this._transaction);
		await admission.admit(this._workflow, { siloId: command.siloId, runId: run.id, attempt: nextAttempt });

		// 5. Write the dispatch event in the same transaction as the attempt, so a retry can never be
		// recorded with nothing coming to collect it. The sequence continues this run's own numbering,
		// and the `${runId}:attempt:${n}` key gives one event per attempt — a second insert for the same
		// attempt would violate the unique key rather than dispatch twice. The payload keeps who asked
		// and their retry key, which is what step 2 reads to recognise a repeat.
		const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.outboxEvent.create({
			data: {
				runId: run.id,
				attempt: nextAttempt,
				sequence: (maximum._max.sequence ?? 0) + 1,
				kind: RunOutboxEventKind.RunAttemptRequested,
				idempotencyKey: `${run.id}:attempt:${nextAttempt}`,
				payload: { runId: run.id, attempt: nextAttempt, requestedBy: command.requestedBy, retryIdempotencyKey: command.idempotencyKey },
				availableAt: new Date(command.acceptedAt),
			},
		});
		return { status: "started", run: _mapRun(updated) } as const;
	}

	/** Reads the committed next attempt after the transaction that tried to create it rolled back. */
	async readRetryWinner(command: StartNextRunAttemptCommand): Promise<StartNextRunAttemptResult | null>
	{
		const participant = await this._transaction.conversationParticipant.findFirst({ where: { conversationId: command.conversationId, userId: command.requestedBy, accessEndedPosition: null, conversation: { siloId: command.siloId } }, select: { conversationId: true } });
		const membership = await this._transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.requestedBy, status: OrgMemberStatus.Active }, select: { id: true } });
		if (participant === null || membership === null) return { outcome: "denied", reason: "unauthorized" };
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null) return null;
		if (run.siloId !== command.siloId || run.conversationId !== command.conversationId) return { outcome: "denied", reason: "unauthorized" };
		const nextAttempt = command.expectedAttempt + 1;
		if (run.attempt !== nextAttempt) return null;
		const event = await this._transaction.outboxEvent.findUnique({ where: { idempotencyKey: `${run.id}:attempt:${nextAttempt}` }, select: { payload: true } });
		return _RetryMatches(event?.payload, command)
			? { outcome: "idempotent", run: _mapRun(run) }
			: { outcome: "denied", reason: "attempt_conflict", currentAttempt: run.attempt };
	}
}

/** Checks whether the already-started next attempt belongs to this exact browser retry request. */
function _RetryMatches(payload: unknown, command: StartNextRunAttemptCommand): boolean
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
	const fields = payload as Readonly<Record<string, unknown>>;
	return fields["runId"] === command.runId && fields["attempt"] === command.expectedAttempt + 1 && fields["requestedBy"] === command.requestedBy && fields["retryIdempotencyKey"] === command.idempotencyKey;
}
