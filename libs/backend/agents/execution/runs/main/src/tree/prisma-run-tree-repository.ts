import { AgentRunTreeClosureReason, type AgentRunTreeAccount, type Prisma } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseRunBudgetPolicy } from "@opencrane/contracts";

import { _ChildAdmissionDigest, _ReservationDigest, _RootAdmissionDigest } from "./run-tree-digest";
import { _RunTreeAllocation } from "./run-tree-mapping";
import { RunTreeClosureReasons, type RunTreeAccount, type RunTreeChildCommand, type RunTreeCloseCommand, type RunTreeRepository, type RunTreeReservation, type RunTreeReservationCommand, type RunTreeResources, type RunTreeRootCommand } from "./run-tree.types";
import { _ParseRunTreeChildCommand, _ParseRunTreeCloseCommand, _ParseRunTreeReservationCommand, _ParseRunTreeRootCommand } from "./run-tree.validator";

/** Maps stored reasons to the domain contract without treating a reason as authorization. */
const _CLOSURE_REASONS: Record<AgentRunTreeClosureReason, RunTreeClosureReasons> = {
	[AgentRunTreeClosureReason.AuthorizedStop]: RunTreeClosureReasons.AuthorizedStop,
	[AgentRunTreeClosureReason.TerminalRun]: RunTreeClosureReasons.TerminalRun,
	[AgentRunTreeClosureReason.Deadline]: RunTreeClosureReasons.Deadline,
};

/** Maps every domain reason back to Prisma's generated names at the persistence edge. */
const _STORED_CLOSURE_REASONS: Record<RunTreeClosureReasons, AgentRunTreeClosureReason> = {
	[RunTreeClosureReasons.AuthorizedStop]: AgentRunTreeClosureReason.AuthorizedStop,
	[RunTreeClosureReasons.TerminalRun]: AgentRunTreeClosureReason.TerminalRun,
	[RunTreeClosureReasons.Deadline]: AgentRunTreeClosureReason.Deadline,
};

/**
 * Applies run-tree accounting through the caller's transaction without opening one or starting work.
 *
 * SQL owns the balance changes and ancestor checks. Until reservation-scoped credentials and tool
 * admission are connected, account-owned runs reject the legacy spending paths to prevent both
 * paths from spending the same allowance.
 * @see RunTreeRepository for transaction, replay and authorization requirements.
 */
export class PrismaRunTreeRepository implements RunTreeRepository
{
	/** Carries the owning admission transaction, never a root database client. */
	private readonly transaction: Prisma.TransactionClient;

	/** Receives the same transaction as current authorization and admitted run writes. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Reads a silo-bound account without checking or granting permission to spend its balance. */
	public async read(siloId: string, runId: string): Promise<RunTreeAccount | null>
	{
		const row = await this.transaction.agentRunTreeAccount.findFirst({ where: { runId, run: { siloId } } });
		return row === null ? null : _MapRunTreeAccount(row);
	}

	/** Freezes snapshot counters and the lower of the revision and trusted server spending caps. */
	public initializeRoot(input: RunTreeRootCommand): Promise<RunTreeAccount>
	{
		const command = _ParseRunTreeRootCommand(input);
		const self = this;
		return ___DoWithTrace("run.tree.initialize", { siloId: command.siloId, runId: command.runId }, async function _Initialize()
		{
			const digest = _RootAdmissionDigest(command);
			const saved = await self.read(command.siloId, command.runId);
			if (saved !== null)
			{
				_AssertAdmission(saved, command.admissionKey, digest);
				return saved;
			}
			const run = await self.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId }, select: { attempt: true, inputSnapshotDigest: true } });
			if (run === null)
				throw new Error("Run tree initialization requires the admitted run");
			const snapshot = await self.transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: command.runId, attempt: run.attempt, digest: run.inputSnapshotDigest } }, select: { budgetPolicy: true } });
			if (snapshot === null)
				throw new Error("Run tree initialization requires the frozen run budget");
			const budget = ___ParseRunBudgetPolicy(snapshot.budgetPolicy);
			const revisionCap = budget.maxCostUsdMicros === null ? command.effectiveCostCapMicros : BigInt(budget.maxCostUsdMicros);
			const costMicros = command.effectiveCostCapMicros < revisionCap ? command.effectiveCostCapMicros : revisionCap;
			const resources: RunTreeResources = { modelCalls: budget.maxModelTurns, completionTokens: budget.maxCompletionTokens, toolInvocations: budget.maxToolInvocations, loopIterations: budget.maxLoopIterations, costMicros };
			const row = await self.transaction.agentRunTreeAccount.create({ data: { runId: command.runId, rootRunId: command.runId, parentRunId: null, admissionKey: command.admissionKey, admissionDigest: digest, deadlineAt: new Date(budget.wallClockDeadlineEpochMs), ..._RunTreeAllocation(resources) } });
			return _MapRunTreeAccount(row);
		});
	}

	/** Moves a parent's available portion to one admitted child; SQL rejects stopped ancestors. */
	public allocateChild(input: RunTreeChildCommand): Promise<RunTreeAccount>
	{
		const command = _ParseRunTreeChildCommand(input);
		const self = this;
		return ___DoWithTrace("run.tree.allocate-child", { siloId: command.siloId, runId: command.runId, parentRunId: command.parentRunId }, async function _Allocate()
		{
			const digest = _ChildAdmissionDigest(command);
			const saved = await self.read(command.siloId, command.runId);
			if (saved !== null)
			{
				_AssertAdmission(saved, command.admissionKey, digest);
				return saved;
			}
			const parent = await self.read(command.siloId, command.parentRunId);
			const run = await self.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId }, select: { id: true } });
			if (parent === null || run === null)
				throw new Error("Run tree allocation requires the admitted parent and child");
			const row = await self.transaction.agentRunTreeAccount.create({ data: { runId: command.runId, rootRunId: parent.rootRunId, parentRunId: parent.runId, admissionKey: command.admissionKey, admissionDigest: digest, deadlineAt: command.deadlineAt, ..._RunTreeAllocation(command.resources) } });
			return _MapRunTreeAccount(row);
		});
	}

	/** Debits one saved resource portion, retaining it through uncertain effects and exact replay. */
	public reserve(input: RunTreeReservationCommand): Promise<RunTreeReservation>
	{
		const command = _ParseRunTreeReservationCommand(input);
		const self = this;
		return ___DoWithTrace("run.tree.reserve", { siloId: command.siloId, runId: command.runId }, async function _Reserve()
		{
			const account = await self.read(command.siloId, command.runId);
			if (account === null)
				throw new Error("Run tree reservation requires the admitted account");
			const commandDigest = _ReservationDigest(command);
			const saved = await self.transaction.agentRunTreeReservation.findUnique({ where: { runId_idempotencyKey: { runId: command.runId, idempotencyKey: command.idempotencyKey } } });
			if (saved !== null)
			{
				if (saved.id !== command.reservationId || saved.commandDigest !== commandDigest)
					throw new Error("Run tree reservation replay changed its saved request");
				return saved;
			}
			return self.transaction.agentRunTreeReservation.create({ data: { id: command.reservationId, runId: command.runId, idempotencyKey: command.idempotencyKey, commandDigest, ...command.resources } });
		});
	}

	/** Closes future admission using stored ancestor Stop/terminal evidence or the database deadline. */
	public close(input: RunTreeCloseCommand): Promise<RunTreeAccount>
	{
		const command = _ParseRunTreeCloseCommand(input);
		const self = this;
		return ___DoWithTrace("run.tree.close", { siloId: command.siloId, runId: command.runId }, async function _Close()
		{
			const account = await self.read(command.siloId, command.runId);
			if (account === null)
				throw new Error("Run tree closure requires the admitted account");
			if (account.closedAt !== null)
			{
				_AssertClosure(account, command);
				return account;
			}
			// Take the root write lock first so closure follows the account-lock order used by admission.
			await self.transaction.agentRunTreeAccount.update({ where: { runId: account.rootRunId }, data: { revision: { increment: 1 } } });
			const clock = await self.transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } });
			const changed = await self.transaction.agentRunTreeAccount.updateMany({ where: { runId: account.runId, closedAt: null }, data: { closedAt: clock.now, closureSourceRunId: command.sourceRunId, closureReason: _STORED_CLOSURE_REASONS[command.reason] } });
			const winner = await self.read(command.siloId, command.runId);
			if (winner === null || winner.closedAt === null)
				throw new Error("Run tree closure did not retain its durable winner");
			_AssertClosure(winner, command);
			if (changed.count !== 0 && changed.count !== 1)
				throw new Error("Run tree closure changed more than its selected account");
			return winner;
		});
	}
}

/** Rejects a retry that would replace the original parent, allowance or deadline. */
function _AssertAdmission(saved: RunTreeAccount, key: string, digest: string): void
{
	if (saved.admissionKey !== key || saved.admissionDigest !== digest)
		throw new Error("Run tree admission replay changed its saved request");
}

/** Keeps the first closure evidence immutable, including after a competing update. */
function _AssertClosure(saved: RunTreeAccount, command: RunTreeCloseCommand): void
{
	if (saved.closureSourceRunId !== command.sourceRunId || saved.closureReason !== command.reason)
		throw new Error("Run tree closure replay changed its saved evidence");
}

/** Exposes saved counters and closure evidence, not permission to run an effect. */
function _MapRunTreeAccount(row: AgentRunTreeAccount): RunTreeAccount
{
	return { ...row, closureReason: row.closureReason === null ? null : _CLOSURE_REASONS[row.closureReason] };
}
