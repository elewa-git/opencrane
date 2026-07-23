import { AgentRunState, Prisma, RunOutboxEventKind, type PrismaClient } from "@prisma/client";

import type { AgentRun, AgentRunState as DomainAgentRunState, AgentRunTerminalReason, AgentRunTrigger, AgentServiceState } from "@opencrane/models/agents";

import type { AgentRunAuthorityRepository, AgentRunAuthoritySnapshot, AtomicRunAttemptResult, AtomicStartNextRunAttemptCommand } from "./run-authority.types.js";

/** Maps a Prisma AgentRun lifecycle identifier to the target contract value. */
function _runState(value: string): DomainAgentRunState
{
	switch (value)
	{
		case "Accepted": return "accepted";
		case "Queued": return "queued";
		case "Assigned": return "assigned";
		case "Running": return "running";
		case "WaitingForApproval": return "waiting_for_approval";
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
function _serviceState(value: string | null): AgentServiceState | null
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
function _mapRun(row: { id: string; siloId: string; agentServiceId: string; agentRevisionId: string; threadId: string | null; trigger: string; delegatedUserId: string | null; requestIdempotencyKey: string; rootRunId: string; parentRunId: string | null; attempt: number; state: string; effectiveContractDigest: string; inputSnapshotDigest: string; acceptedAt: Date; startedAt: Date | null; finishedAt: Date | null; terminalReason: string | null }): AgentRun
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		threadId: row.threadId,
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

/** Prisma-backed single-run authority with atomic retry and outbox publication. */
export class PrismaAgentRunAuthorityRepository implements AgentRunAuthorityRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates a run-authority adapter over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads run and referenced service state inside one database transaction. */
	async getRunAuthority(runId: string): Promise<AgentRunAuthoritySnapshot | null>
	{
		return this.prisma.$transaction(async function _load(transaction: Prisma.TransactionClient)
		{
			const run = await transaction.agentRun.findUnique({ where: { id: runId } });
			if (run === null) return null;
			const service = await transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
			return {
				run: _mapRun(run),
				agentServiceSiloId: service?.siloId ?? null,
				agentServiceState: _serviceState(service?.state ?? null),
				activeAgentRevisionId: service?.activeRevisionId ?? null,
			};
		});
	}

	/** Atomically starts the next attempt and appends its run-domain outbox event. */
	async startNextAttemptAtomically(command: AtomicStartNextRunAttemptCommand): Promise<AtomicRunAttemptResult>
	{
		return this.prisma.$transaction(async function _start(transaction: Prisma.TransactionClient)
		{
			// 1. Lock parent service before the logical run to preserve the authority lock order.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${command.expectedAgentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
			const service = await transaction.agentService.findUnique({ where: { id: command.expectedAgentServiceId } });
			const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
			if (run === null) return { status: "not_found" } as const;
			if (run.attempt !== command.expectedAttempt) return { status: "attempt_conflict", currentAttempt: run.attempt } as const;
			if (run.agentServiceId !== command.expectedAgentServiceId || service?.state !== "Active" || service.siloId !== command.expectedAgentServiceSiloId || service.activeRevisionId !== command.expectedActiveAgentRevisionId)
			{
				return { status: "agent_service_authority_conflict", currentAgentServiceState: _serviceState(service?.state ?? null), currentAgentServiceSiloId: service?.siloId ?? null, currentActiveAgentRevisionId: service?.activeRevisionId ?? null } as const;
			}

			// 2. Reset only attempt-local coordinates while preserving the single logical run identity.
			const nextAttempt = run.attempt + 1;
			const updated = await transaction.agentRun.update({
				where: { id: run.id },
				data: { attempt: nextAttempt, state: AgentRunState.Accepted, acceptedAt: new Date(command.acceptedAt), startedAt: null, finishedAt: null, terminalReason: null, costAmount: null, costCurrency: null },
			});

			// 3. Commit the retry request through the run-owned outbox so dispatch cannot be lost.
			const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			await transaction.outboxEvent.create({
				data: {
					runId: run.id,
					attempt: nextAttempt,
					sequence: (maximum._max.sequence ?? 0) + 1,
					kind: RunOutboxEventKind.RunAttemptRequested,
					idempotencyKey: `${run.id}:attempt:${nextAttempt}`,
					payload: { runId: run.id, attempt: nextAttempt },
					availableAt: new Date(command.acceptedAt),
				},
			});
			return { status: "started", run: _mapRun(updated) } as const;
		});
	}
}
