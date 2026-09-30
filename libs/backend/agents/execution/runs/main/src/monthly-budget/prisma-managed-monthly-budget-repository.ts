import { AgentRunState, ManagedBudgetAttemptState, ManagedBudgetEffectState, ManagedBudgetScope, type Prisma } from "@prisma/client";

import { ___ParseRunBudgetPolicy, ConversationModelUsageKinds, ConversationModelUsageUnknownReasons } from "@opencrane/contracts";

import { _PriceEurMicros } from "./monthly-budget-math";
import { _RunInputSnapshot } from "../prisma-run-admission-unit-of-work";
import { _AdmissionClosed, _AssertAttemptMatches, _AssertEffectMatchesReserve, _AssertPreForwardReceipt, _ExactAttempt, _Incurred, _IncurredAndClaimed, _IsClosed, _IsProvenPersonalRun, _IsTerminal, _ModelRoute, _PossibleLiability, _ReceiptMatches, _RequireApplicablePolicies, _RequireManagedPayer, _Reservation, _State, _TariffMatches, _TerminalSettlement } from "./monthly-budget-ledger-state";
import type { ManagedMonthlyBudgetAccountRecord, ManagedMonthlyBudgetClaimCoverage, ManagedMonthlyBudgetEffectRecord, ManagedMonthlyBudgetRunRecord } from "./monthly-budget-persistence.types";
import { ManagedMonthlyBudgetReservationStates, ManagedMonthlyBudgetReserveResultKinds, type ManagedMonthlyBudgetAttemptCommand, type ManagedMonthlyBudgetAuthority, type ManagedMonthlyBudgetClaimResult, type ManagedMonthlyBudgetPreForwardReleaseCommand, type ManagedMonthlyBudgetReservation, type ManagedMonthlyBudgetReserveCommand, type ManagedMonthlyBudgetReserveResult, type ManagedMonthlyBudgetSettlementCommand, type ManagedMonthlyBudgetSettlementResult } from "./monthly-budget.types";
import { _ManagedMonthlyBudgetPeriodStart, _MAX_SIGNED_BIGINT, _PrepareManagedMonthlyBudgetReserve, _ValidateManagedMonthlyBudgetAttempt } from "./monthly-budget-validation";

/** Transaction-bound implementation of the managed monthly EUR ledger. */
export class PrismaManagedMonthlyBudgetRepository implements ManagedMonthlyBudgetAuthority
{
	/** Stores the callback-scoped client; this class never opens or owns a transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** @inheritdoc */
	public async reserve(command: ManagedMonthlyBudgetReserveCommand): Promise<ManagedMonthlyBudgetReserveResult>
	{
		const run = await this._ReadRun(command);
		if (_IsProvenPersonalRun(run))
			return { kind: ManagedMonthlyBudgetReserveResultKinds.Personal };
		_RequireManagedPayer(run);
		const prepared = _PrepareManagedMonthlyBudgetReserve(command);
		const existing = await this._ReadEffectByLogicalFence(command.runId, command.logicalFence);
		if (existing !== null)
		{
			_AssertEffectMatchesReserve(existing, prepared, run);
			return { kind: ManagedMonthlyBudgetReserveResultKinds.Reserved, reservation: _Reservation(existing) };
		}
		if (run.state !== AgentRunState.Running)
			throw new Error("Managed monthly budget requires a currently running admitted attempt");
		const now = await this._DatabaseNow();
		if (!await this._AssertRunSnapshotAllows(run, command.modelAlias, command.maxCompletionTokens, now))
			throw new Error("Managed monthly budget cannot reserve after the immutable run deadline");
		const tariff = await this.transaction.modelEurTariffRevision.findUnique({ where: { siloId_digest: { siloId: command.siloId, digest: prepared.quote.tariff.digest } }, include: { modelDefinition: true } });
		if (tariff === null || !_TariffMatches(tariff, prepared, now))
			throw new Error("Managed monthly budget requires the exact current immutable tariff row");
		const periodStart = _ManagedMonthlyBudgetPeriodStart(now);
		const policies = await this._LockApplicablePolicies(command.siloId, run.payingGroupId!, run.agentServiceId);
		const accounts = await Promise.all(policies.map(policy => this._SynchronizeAccount(policy, periodStart, now)));
		if (accounts.some(_IsClosed))
			return { kind: ManagedMonthlyBudgetReserveResultKinds.AdmissionClosed };
		if (accounts.some(account => _PossibleLiability(account) + prepared.worstCaseEurMicros > account.limitEurMicros))
			return { kind: ManagedMonthlyBudgetReserveResultKinds.InsufficientCapacity };
		for (const account of accounts)
		{
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: account.id }, data: { reservedEurMicros: { increment: prepared.worstCaseEurMicros }, revision: { increment: 1 } } });
		}
		const effect = await this.transaction.managedBudgetEffect.create({
			data: {
				siloId: command.siloId, runId: run.id, runAttempt: run.attempt, payingGroupId: run.payingGroupId!, agentServiceId: run.agentServiceId,
				logicalFence: command.logicalFence, modelAlias: command.modelAlias, periodStart, tariffRevisionId: tariff.id, tariffRevision: tariff.revision,
				tariffDigest: tariff.digest, quoteDigest: prepared.quoteDigest, maxInputTokens: tariff.maxInputTokens, maxCompletionTokens: command.maxCompletionTokens,
				worstCaseEurMicros: prepared.worstCaseEurMicros,
				impacts: { create: accounts.map(account => ({ accountId: account.id, siloId: command.siloId })) },
			},
			include: _EFFECT_INCLUDE,
		});
		return { kind: ManagedMonthlyBudgetReserveResultKinds.Reserved, reservation: _Reservation(effect) };
	}

	/** @inheritdoc */
	public async claim(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetClaimResult>
	{
		_ValidateManagedMonthlyBudgetAttempt(command);
		let effect = await this._ReadExactEffect(command.reservation);
		const now = await this._DatabaseNow();
		const replay = effect.attempts.find(attempt => attempt.physicalNonce === command.physicalNonce);
		if (replay !== undefined)
		{
			_AssertAttemptMatches(replay, command);
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: _AdmissionClosed(effect) };
		}
		if (effect.state !== ManagedBudgetEffectState.Reserved)
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: _AdmissionClosed(effect) };
		if (effect.periodStart.getTime() !== _ManagedMonthlyBudgetPeriodStart(now).getTime())
		{
			effect = await this._CancelReserved(effect, now);
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: false };
		}
		if (now < effect.tariff.effectiveAt || now >= effect.tariff.validUntil)
		{
			effect = await this._CancelReserved(effect, now);
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: false };
		}
		if (!await this._AssertCurrentRunMaySpend(effect, command.deadlineEpochMs, now))
		{
			effect = await this._CancelReserved(effect, now);
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: false };
		}
		const coverage = await this._RefreshClaimCoverage(effect, now);
		effect = coverage.effect;
		if (coverage.admissionClosed)
		{
			effect = await this._CancelReserved(effect, now);
			return { mayDispatch: false, state: _State(effect.state), admissionClosed: true };
		}
		if (coverage.insufficientCapacity)
			return { mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Reserved, admissionClosed: false };
		if (effect.impacts.some(impact => _IncurredAndClaimed(impact.account) + effect.worstCaseEurMicros > impact.account.limitEurMicros))
			return { mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Reserved, admissionClosed: false };
		for (const impact of effect.impacts)
		{
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data: { reservedEurMicros: { decrement: effect.worstCaseEurMicros }, claimedEurMicros: { increment: effect.worstCaseEurMicros }, revision: { increment: 1 } } });
		}
		await this.transaction.managedBudgetPhysicalAttempt.create({ data: { siloId: effect.siloId, effectId: effect.id, physicalNonce: command.physicalNonce, requestBodySha256: command.requestBodySha256, deadlineEpochMs: BigInt(command.deadlineEpochMs), claimedAt: now } });
		effect = await this.transaction.managedBudgetEffect.update({ where: { id: effect.id }, data: { state: ManagedBudgetEffectState.Claimed }, include: _EFFECT_INCLUDE });
		return { mayDispatch: true, state: ManagedMonthlyBudgetReservationStates.Claimed, admissionClosed: false };
	}

	/** @inheritdoc */
	public async releasePreForward(command: ManagedMonthlyBudgetPreForwardReleaseCommand): Promise<void>
	{
		_ValidateManagedMonthlyBudgetAttempt(command);
		_AssertPreForwardReceipt(command);
		let effect = await this._ReadExactEffect(command.reservation);
		const attempt = _ExactAttempt(effect, command);
		if (attempt.state === ManagedBudgetAttemptState.PreForwardRejected)
			return;
		if (effect.state !== ManagedBudgetEffectState.Claimed || attempt.state !== ManagedBudgetAttemptState.Claimed)
			throw new Error("Managed monthly budget no-forward proof does not match an active physical claim");
		const now = await this._DatabaseNow();
		effect = await this._RefreshAccounts(effect.id, now);
		const usable = !_AdmissionClosed(effect) && effect.impacts.every(impact => _PossibleLiability(impact.account) <= impact.account.limitEurMicros);
		for (const impact of effect.impacts)
		{
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data: usable
				? { claimedEurMicros: { decrement: effect.worstCaseEurMicros }, reservedEurMicros: { increment: effect.worstCaseEurMicros }, revision: { increment: 1 } }
				: { claimedEurMicros: { decrement: effect.worstCaseEurMicros }, revision: { increment: 1 } } });
		}
		await this.transaction.managedBudgetPhysicalAttempt.update({ where: { id: attempt.id }, data: { state: ManagedBudgetAttemptState.PreForwardRejected, terminalAt: now } });
		await this.transaction.managedBudgetEffect.update({ where: { id: effect.id }, data: usable ? { state: ManagedBudgetEffectState.Reserved } : { state: ManagedBudgetEffectState.Cancelled, terminalAt: now } });
	}

	/** @inheritdoc */
	public async settle(command: ManagedMonthlyBudgetSettlementCommand): Promise<ManagedMonthlyBudgetSettlementResult>
	{
		_ValidateManagedMonthlyBudgetAttempt(command);
		if (command.usage.kind === ConversationModelUsageKinds.Unknown)
		{
			if (command.usage.reason === ConversationModelUsageUnknownReasons.PreForwardRejected)
				throw new Error("Managed monthly budget requires authenticated release proof for a pre-forward rejection");
			return this._RetainUnknown(command);
		}
		if (!Number.isSafeInteger(command.usage.inputTokens) || command.usage.inputTokens < 0 || !Number.isSafeInteger(command.usage.outputTokens) || command.usage.outputTokens < 0)
			throw new Error("Managed monthly budget usage counts are invalid");
		let effect = await this._ReadExactEffect(command.reservation);
		const attempt = _ExactAttempt(effect, command);
		if (_IsTerminal(effect.state))
			return _TerminalSettlement(effect);
		if (effect.state !== ManagedBudgetEffectState.Claimed || attempt.state !== ManagedBudgetAttemptState.Claimed)
			throw new Error("Managed monthly budget settlement requires the exact active physical claim");
		const actual = _PriceEurMicros(command.usage.inputTokens, command.usage.outputTokens, effect.tariff.inputEurMicrosPerUnit, effect.tariff.outputEurMicrosPerUnit, effect.tariff.tokenUnit);
		const aboveAdmittedBound = actual > effect.worstCaseEurMicros;
		const now = await this._DatabaseNow();
		effect = await this._RefreshAccounts(effect.id, now);
		const counterOverflow = actual > _MAX_SIGNED_BIGINT || effect.impacts.some(impact => impact.account.settledEurMicros + actual > _MAX_SIGNED_BIGINT);
		const priceIntegrityBreach = aboveAdmittedBound || counterOverflow;
		for (const impact of effect.impacts)
		{
			const data = counterOverflow
				? { claimedEurMicros: { decrement: effect.worstCaseEurMicros }, unknownEurMicros: { increment: effect.worstCaseEurMicros }, admissionClosedAt: impact.account.admissionClosedAt ?? now, revision: { increment: 1 } }
				: { claimedEurMicros: { decrement: effect.worstCaseEurMicros }, settledEurMicros: { increment: actual }, ...(priceIntegrityBreach ? { admissionClosedAt: impact.account.admissionClosedAt ?? now } : {}), revision: { increment: 1 } };
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data });
		}
		await this.transaction.managedBudgetPhysicalAttempt.update({ where: { id: attempt.id }, data: { state: ManagedBudgetAttemptState.Settled, terminalAt: now } });
		effect = await this.transaction.managedBudgetEffect.update({ where: { id: effect.id }, data: {
			state: priceIntegrityBreach ? ManagedBudgetEffectState.PriceIntegrityBreach : ManagedBudgetEffectState.Settled,
			actualEurMicros: actual <= _MAX_SIGNED_BIGINT ? actual : null,
			actualInputTokens: BigInt(command.usage.inputTokens), actualOutputTokens: BigInt(command.usage.outputTokens), terminalAt: now,
		}, include: _EFFECT_INCLUDE });
		if (!priceIntegrityBreach)
			effect = await this._CloseAtIncurredLimit(effect, now);
		return { state: _State(effect.state), actualEurMicros: actual.toString(), admissionClosed: _AdmissionClosed(effect) };
	}

	/** @inheritdoc */
	public async retainUnknown(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetSettlementResult>
	{
		_ValidateManagedMonthlyBudgetAttempt(command);
		return this._RetainUnknown(command);
	}

	/** Convert one active claim to durable worst-case unknown liability. */
	private async _RetainUnknown(command: ManagedMonthlyBudgetAttemptCommand): Promise<ManagedMonthlyBudgetSettlementResult>
	{
		let effect = await this._ReadExactEffect(command.reservation);
		const attempt = _ExactAttempt(effect, command);
		if (_IsTerminal(effect.state))
			return _TerminalSettlement(effect);
		if (effect.state !== ManagedBudgetEffectState.Claimed || attempt.state !== ManagedBudgetAttemptState.Claimed)
			throw new Error("Managed monthly budget unknown retention requires the exact active physical claim");
		const now = await this._DatabaseNow();
		effect = await this._RefreshAccounts(effect.id, now);
		for (const impact of effect.impacts)
		{
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data: { claimedEurMicros: { decrement: effect.worstCaseEurMicros }, unknownEurMicros: { increment: effect.worstCaseEurMicros }, revision: { increment: 1 } } });
		}
		await this.transaction.managedBudgetPhysicalAttempt.update({ where: { id: attempt.id }, data: { state: ManagedBudgetAttemptState.Unknown, terminalAt: now } });
		effect = await this.transaction.managedBudgetEffect.update({ where: { id: effect.id }, data: { state: ManagedBudgetEffectState.Unknown, terminalAt: now }, include: _EFFECT_INCLUDE });
		effect = await this._CloseAtIncurredLimit(effect, now);
		return { state: ManagedMonthlyBudgetReservationStates.Unknown, admissionClosed: _AdmissionClosed(effect) };
	}

	/** Read one run and its saved service ownership. */
	private async _ReadRun(command: ManagedMonthlyBudgetReserveCommand): Promise<ManagedMonthlyBudgetRunRecord>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id_siloId: { id: command.runId, siloId: command.siloId } }, include: { service: { select: { kind: true } } } });
		if (run === null || run.attempt !== command.runAttempt)
			throw new Error("Managed monthly budget requires the exact admitted run attempt");
		return run;
	}

	/** Read an exact logical winner, if one already exists. */
	private _ReadEffectByLogicalFence(runId: string, logicalFence: string): Promise<ManagedMonthlyBudgetEffectRecord | null>
	{
		return this.transaction.managedBudgetEffect.findUnique({ where: { runId_logicalFence: { runId, logicalFence } }, include: _EFFECT_INCLUDE });
	}

	/** Load a receipt-bound effect and reject every changed replay coordinate. */
	private async _ReadExactEffect(reservation: ManagedMonthlyBudgetReservation): Promise<ManagedMonthlyBudgetEffectRecord>
	{
		const effect = await this.transaction.managedBudgetEffect.findUnique({ where: { id: reservation.effectId }, include: _EFFECT_INCLUDE });
		if (effect === null || !_ReceiptMatches(effect, reservation))
			throw new Error("Managed monthly budget receipt does not match its durable effect");
		return effect;
	}

	/** Select and lock the mandatory global/group policies plus the optional assistant policy. */
	private async _LockApplicablePolicies(siloId: string, payingGroupId: string, agentServiceId: string)
	{
		let policies = await this.transaction.managedBudgetPolicy.findMany({ where: { siloId, OR: [
			{ scope: ManagedBudgetScope.Global, scopeKey: "global", groupId: null, agentServiceId: null },
			{ scope: ManagedBudgetScope.Group, scopeKey: payingGroupId, groupId: payingGroupId, agentServiceId: null },
			{ scope: ManagedBudgetScope.AgentService, scopeKey: agentServiceId, groupId: null, agentServiceId },
		] }, orderBy: { id: "asc" } });
		_RequireApplicablePolicies(policies, payingGroupId);
		for (const policy of policies)
		{
			await this.transaction.managedBudgetPolicyFence.upsert({ where: { policyId: policy.id }, create: { policyId: policy.id }, update: { revision: { increment: 1 } } });
		}
		policies = await this.transaction.managedBudgetPolicy.findMany({ where: { id: { in: policies.map(policy => policy.id) }, siloId }, orderBy: { id: "asc" } });
		_RequireApplicablePolicies(policies, payingGroupId);
		return policies;
	}

	/** Create or refresh one monthly account from its current policy. */
	private async _SynchronizeAccount(policy: Prisma.ManagedBudgetPolicyGetPayload<object>, periodStart: Date, now: Date): Promise<ManagedMonthlyBudgetAccountRecord>
	{
		if (policy.limitEurMicros < 0n || policy.limitEurMicros > _MAX_SIGNED_BIGINT || policy.revision < 1)
			throw new Error("Managed monthly budget policy has invalid limits or revision");
		let account = await this.transaction.managedBudgetMonthlyAccount.upsert({
			where: { policyId_periodStart: { policyId: policy.id, periodStart } },
			create: { siloId: policy.siloId, policyId: policy.id, periodStart, policyRevision: policy.revision, limitEurMicros: policy.limitEurMicros },
			update: { policyRevision: policy.revision, limitEurMicros: policy.limitEurMicros, revision: { increment: 1 } }, include: { policy: true },
		});
		if (account.admissionClosedAt === null && _Incurred(account) >= policy.limitEurMicros)
			account = await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: account.id }, data: { admissionClosedAt: now, revision: { increment: 1 } }, include: { policy: true } });
		return account;
	}

	/** Lock current policies and synchronize every account impacted by an effect. */
	private async _RefreshAccounts(effectId: string, now: Date): Promise<ManagedMonthlyBudgetEffectRecord>
	{
		let effect = await this.transaction.managedBudgetEffect.findUniqueOrThrow({ where: { id: effectId }, include: _EFFECT_INCLUDE });
		for (const impact of effect.impacts)
		{
			await this.transaction.managedBudgetPolicyFence.upsert({ where: { policyId: impact.account.policyId }, create: { policyId: impact.account.policyId }, update: { revision: { increment: 1 } } });
		}
		effect = await this.transaction.managedBudgetEffect.findUniqueOrThrow({ where: { id: effectId }, include: _EFFECT_INCLUDE });
		for (const impact of effect.impacts)
			await this._SynchronizeAccount(impact.account.policy, impact.account.periodStart, now);
		return this.transaction.managedBudgetEffect.findUniqueOrThrow({ where: { id: effectId }, include: _EFFECT_INCLUDE });
	}

	/** Re-read every currently applicable policy and attach any newly introduced optional ceiling. */
	private async _RefreshClaimCoverage(effect: ManagedMonthlyBudgetEffectRecord, now: Date): Promise<ManagedMonthlyBudgetClaimCoverage>
	{
		const policies = await this._LockApplicablePolicies(effect.siloId, effect.payingGroupId, effect.agentServiceId);
		const currentIds = new Set(policies.map(policy => policy.id));
		if (effect.impacts.some(impact => !currentIds.has(impact.account.policyId)))
			throw new Error("Managed monthly budget policy coverage changed incompatibly after reservation");
		const accounts = await Promise.all(policies.map(policy => this._SynchronizeAccount(policy, effect.periodStart, now)));
		const impactedIds = new Set(effect.impacts.map(impact => impact.account.policyId));
		const missing = accounts.filter(account => !impactedIds.has(account.policyId));
		if (accounts.some(_IsClosed))
			return { effect: await this._RefreshAccounts(effect.id, now), admissionClosed: true, insufficientCapacity: false };
		if (missing.some(account => _PossibleLiability(account) + effect.worstCaseEurMicros > account.limitEurMicros))
			return { effect: await this._RefreshAccounts(effect.id, now), admissionClosed: false, insufficientCapacity: true };
		for (const account of missing)
		{
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: account.id }, data: { reservedEurMicros: { increment: effect.worstCaseEurMicros }, revision: { increment: 1 } } });
			await this.transaction.managedBudgetScopeImpact.create({ data: { effectId: effect.id, accountId: account.id, siloId: effect.siloId } });
		}
		return { effect: await this._RefreshAccounts(effect.id, now), admissionClosed: false, insufficientCapacity: false };
	}

	/** Revalidate the exact admitted run immediately before a physical claim. */
	private async _AssertCurrentRunMaySpend(effect: ManagedMonthlyBudgetEffectRecord, deadlineEpochMs: number, now: Date): Promise<boolean>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id_siloId: { id: effect.runId, siloId: effect.siloId } }, include: { service: { select: { kind: true } } } });
		if (run === null || run.attempt !== effect.runAttempt || run.state !== AgentRunState.Running)
			return false;
		if (run.agentServiceId !== effect.agentServiceId || run.payingGroupId !== effect.payingGroupId)
			throw new Error("Managed monthly budget physical claim found changed service or payer coordinates");
		if (_IsProvenPersonalRun(run))
			throw new Error("Managed monthly budget effect cannot belong to a personal run");
		_RequireManagedPayer(run);
		return this._AssertRunSnapshotAllows(run, effect.modelAlias, effect.maxCompletionTokens, now, deadlineEpochMs);
	}

	/** Bind model, token ceiling and time to the immutable saved input for the exact attempt. */
	private async _AssertRunSnapshotAllows(run: ManagedMonthlyBudgetRunRecord, modelAlias: string, maxCompletionTokens: number, now: Date, deadlineEpochMs?: number): Promise<boolean>
	{
		const row = await this.transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: run.attempt, digest: run.inputSnapshotDigest } } });
		if (row === null)
			throw new Error("Managed monthly budget requires the immutable run input snapshot");
		const snapshot = _RunInputSnapshot(row);
		const budget = ___ParseRunBudgetPolicy(snapshot.budgetPolicy);
		const route = _ModelRoute(snapshot.modelRoute);
		if (route.alias !== modelAlias || maxCompletionTokens > budget.maxCompletionTokens || route.maxOutputTokens !== null && maxCompletionTokens > route.maxOutputTokens)
			throw new Error("Managed monthly budget request exceeds the immutable model route or token ceiling");
		return now.getTime() < budget.wallClockDeadlineEpochMs && (deadlineEpochMs === undefined || now.getTime() < deadlineEpochMs && deadlineEpochMs <= budget.wallClockDeadlineEpochMs);
	}

	/** Cancel an undispatched hold after a durable close. */
	private async _CancelReserved(effect: ManagedMonthlyBudgetEffectRecord, now: Date): Promise<ManagedMonthlyBudgetEffectRecord>
	{
		for (const impact of effect.impacts)
			await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data: { reservedEurMicros: { decrement: effect.worstCaseEurMicros }, revision: { increment: 1 } } });
		return this.transaction.managedBudgetEffect.update({ where: { id: effect.id }, data: { state: ManagedBudgetEffectState.Cancelled, terminalAt: now }, include: _EFFECT_INCLUDE });
	}

	/** Permanently close accounts whose irrevocable liability reached the current policy limit. */
	private async _CloseAtIncurredLimit(effect: ManagedMonthlyBudgetEffectRecord, now: Date): Promise<ManagedMonthlyBudgetEffectRecord>
	{
		for (const impact of effect.impacts)
		{
			if (impact.account.admissionClosedAt === null && _Incurred(impact.account) >= impact.account.limitEurMicros)
				await this.transaction.managedBudgetMonthlyAccount.update({ where: { id: impact.accountId }, data: { admissionClosedAt: now, revision: { increment: 1 } } });
		}
		return this.transaction.managedBudgetEffect.findUniqueOrThrow({ where: { id: effect.id }, include: _EFFECT_INCLUDE });
	}

	/** Read the database authority clock. */
	private async _DatabaseNow(): Promise<Date>
	{
		return (await this.transaction.agentRunAuthorityClock.findUniqueOrThrow({ where: { singleton: 1 }, select: { now: true } })).now;
	}
}

const _EFFECT_INCLUDE = { tariff: true, attempts: { orderBy: { id: "asc" } }, impacts: { orderBy: { accountId: "asc" }, include: { account: { include: { policy: true } } } } } as const;
