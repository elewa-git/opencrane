import type { PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaManagedMonthlyBudgetRepository } from "./prisma-managed-monthly-budget-repository";
import type { ManagedMonthlyBudgetAttemptCommand, ManagedMonthlyBudgetAuthority, ManagedMonthlyBudgetClaimResult, ManagedMonthlyBudgetPreForwardReleaseCommand, ManagedMonthlyBudgetReserveCommand, ManagedMonthlyBudgetReserveResult, ManagedMonthlyBudgetSettlementCommand, ManagedMonthlyBudgetSettlementResult } from "./monthly-budget.types";

/** Opens every managed monthly-budget transition in one bounded Serializable transaction. */
export class PrismaManagedMonthlyBudgetUnitOfWork implements ManagedMonthlyBudgetAuthority
{
	/** Root client used only to open callback-scoped transaction attempts. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** @inheritdoc */
	public reserve(command: ManagedMonthlyBudgetReserveCommand): Promise<ManagedMonthlyBudgetReserveResult>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("managed_budget.reserve", { siloId: command.siloId, runId: command.runId, runAttempt: command.runAttempt }, function _TraceReserve()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Reserve(transaction)
			{
				return new PrismaManagedMonthlyBudgetRepository(transaction).reserve(command);
			}, _POLICY("managed-monthly-budget-reserve"));
		});
	}

	/** @inheritdoc */
	public claim(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetClaimResult>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("managed_budget.claim", _TraceAttempt(command), function _TraceClaim()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Claim(transaction)
			{
				return new PrismaManagedMonthlyBudgetRepository(transaction).claim(command);
			}, _POLICY("managed-monthly-budget-claim"));
		});
	}

	/** @inheritdoc */
	public releasePreForward(command: ManagedMonthlyBudgetPreForwardReleaseCommand): Promise<void>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("managed_budget.release_pre_forward", _TraceAttempt(command), function _TraceRelease()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Release(transaction)
			{
				return new PrismaManagedMonthlyBudgetRepository(transaction).releasePreForward(command);
			}, _POLICY("managed-monthly-budget-release-pre-forward"));
		});
	}

	/** @inheritdoc */
	public settle(command: ManagedMonthlyBudgetSettlementCommand): Promise<ManagedMonthlyBudgetSettlementResult>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("managed_budget.settle", _TraceAttempt(command), function _TraceSettle()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Settle(transaction)
			{
				return new PrismaManagedMonthlyBudgetRepository(transaction).settle(command);
			}, _POLICY("managed-monthly-budget-settle"));
		});
	}

	/** @inheritdoc */
	public retainUnknown(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetSettlementResult>
	{
		const prisma = this.prisma;
		return ___DoWithTrace("managed_budget.retain_unknown", _TraceAttempt(command), function _TraceUnknown()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _RetainUnknown(transaction)
			{
				return new PrismaManagedMonthlyBudgetRepository(transaction).retainUnknown(command);
			}, _POLICY("managed-monthly-budget-retain-unknown"));
		});
	}
}

/** Return the shared bounded-retry policy for one complete idempotent transition. */
function _POLICY(operation: string): { readonly isolationLevel: "Serializable"; readonly operation: string; readonly attemptLimit: 3 }
{
	return { isolationLevel: "Serializable", operation, attemptLimit: 3 };
}

/** Select non-secret immutable effect coordinates for tracing. */
function _TraceAttempt(command: ManagedMonthlyBudgetAttemptCommand): Record<string, unknown>
{
	return { siloId: command.reservation.siloId, runId: command.reservation.runId, runAttempt: command.reservation.runAttempt, effectId: command.reservation.effectId };
}
