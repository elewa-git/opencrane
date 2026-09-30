import { AgentRunState, AgentServiceKind, ManagedBudgetAttemptState, ManagedBudgetEffectState, ManagedBudgetScope } from "@prisma/client";
import { ExecutionSubjectMembershipKinds, ConversationModelPreForwardContracts, ConversationModelPreForwardReasons, ConversationModelUsageKinds, RUN_INPUT_SNAPSHOT_VERSION } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { PrismaManagedMonthlyBudgetUnitOfWork } from "../prisma-managed-monthly-budget-unit-of-work";
import { ManagedMonthlyBudgetReservationStates, ManagedMonthlyBudgetReserveResultKinds } from "../monthly-budget.types";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const BODY_DIGEST = "a".repeat(64);
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

interface Fixture
{
	readonly authority: PrismaManagedMonthlyBudgetUnitOfWork;
	readonly state: { now: Date; tariff: Record<string, unknown>; run: Record<string, unknown>; policies: Record<string, unknown>[]; accounts: Record<string, unknown>[]; effects: Record<string, unknown>[]; attempts: Record<string, unknown>[]; optionalPolicy: Record<string, unknown> };
}

describe("PrismaManagedMonthlyBudgetUnitOfWork", function _Suite()
{
	it("returns Personal only for a proven personal service with no managed payer evidence", async function _PersonalAuthority()
	{
		const personal = _Fixture(AgentServiceKind.Personal);
		await expect(personal.authority.reserve(_reserveCommand())).resolves.toEqual({ kind: ManagedMonthlyBudgetReserveResultKinds.Personal });

		for (const payerFields of [{ payingGroupId: "group-1" }, { payingGroupAuthorizationDecisionDigest: "decision" }, { payingGroupEffectiveAuthorizationDigest: "effective" }])
		{
			const managed = _Fixture(AgentServiceKind.Managed);
			Object.assign(managed.state.run, { payingGroupId: null, payingGroupAuthorizationDecisionDigest: null, payingGroupAuthorizationPolicyRevisionHash: null, payingGroupEffectiveAuthorizationDigest: null }, payerFields);
			await expect(managed.authority.reserve(_reserveCommand())).rejects.toThrow(/complete paying-group authorization evidence/);
		}
	});

	it("returns a receipt containing every immutable logical and tariff coordinate", async function _ReservationReceipt()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const result = await fixture.authority.reserve(_reserveCommand());
		expect(result.kind).toBe(ManagedMonthlyBudgetReserveResultKinds.Reserved);
		if (result.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			return;
		expect(result.reservation).toMatchObject({
			effectId: "effect-1", siloId: "silo-1", runId: "run-1", runAttempt: 1, payingGroupId: "group-1", agentServiceId: "service-1",
			logicalFence: "1".repeat(64), modelAlias: "model-1", maxInputTokens: 100, maxCompletionTokens: 100,
			periodStart: "2026-09-01T00:00:00.000Z", worstCaseEurMicros: "300", tariffRevisionId: "tariff-1", tariffRevision: 1,
			state: ManagedMonthlyBudgetReservationStates.Reserved,
		});
		expect(result.reservation.tariffDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(result.reservation.quoteDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(fixture.state.effects[0]?.impactAccountIds).toEqual(["account-global", "account-group"]);
	});

	it("replays one exact logical reservation but rejects changed coordinates", async function _LogicalReplay()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const first = await fixture.authority.reserve(_reserveCommand());
		await expect(fixture.authority.reserve(_reserveCommand())).resolves.toEqual(first);
		await expect(fixture.authority.reserve({ ..._reserveCommand(), maxCompletionTokens: 99, quote: _quote(99) })).rejects.toThrow(/logical fence was already used/);
	});

	it("distinguishes temporary capacity exhaustion from durable admission closure", async function _AdmissionOutcomes()
	{
		const insufficient = _Fixture(AgentServiceKind.Managed);
		for (const account of insufficient.state.accounts)
			account.limitEurMicros = 299n;
		for (const policy of insufficient.state.policies)
			policy.limitEurMicros = 299n;
		await expect(insufficient.authority.reserve(_reserveCommand())).resolves.toEqual({ kind: ManagedMonthlyBudgetReserveResultKinds.InsufficientCapacity });

		const closed = _Fixture(AgentServiceKind.Managed);
		for (const account of closed.state.accounts)
			account.admissionClosedAt = NOW;
		await expect(closed.authority.reserve(_reserveCommand())).resolves.toEqual({ kind: ManagedMonthlyBudgetReserveResultKinds.AdmissionClosed });
	});

	it("allows only one physical claim and binds replay to body digest and deadline", async function _SingleClaim()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await expect(fixture.authority.claim(attempt)).resolves.toMatchObject({ mayDispatch: true, state: ManagedMonthlyBudgetReservationStates.Claimed, admissionClosed: false });
		await expect(fixture.authority.claim(attempt)).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Claimed });
		await expect(fixture.authority.claim({ ...attempt, requestBodySha256: "b".repeat(64) })).rejects.toThrow(/physical nonce was already used/);
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-2"))).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Claimed });
	});

	it("rejects malformed and changed tariff or reservation evidence", async function _BindingRejection()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await expect(fixture.authority.claim({ ...attempt, requestBodySha256: "malformed" })).rejects.toThrow();
		await expect(fixture.authority.claim({ ...attempt, reservation: { ...reserved.reservation, tariffDigest: `sha256:${"b".repeat(64)}` } })).rejects.toThrow(/receipt does not match/);
		const changedModelTariff = _tariff({ modelAlias: "model-2" });
		await expect(fixture.authority.reserve({ ..._reserveCommand(), modelAlias: "model-2", quote: _quote(100, changedModelTariff) })).rejects.toThrow(/logical fence was already used/);
		await fixture.authority.claim(attempt);
		await expect(fixture.authority.releasePreForward({ ...attempt, receipt: _receipt(reserved.reservation.logicalFence, { ...attempt, requestBodySha256: "b".repeat(64) }) })).rejects.toThrow(/receipt does not match/);
	});

	it("cancels a reserved effect when the admitted run stops, changes attempt, or misses its deadline", async function _RunFenceRejection()
	{
		for (const change of [
			(run: Record<string, unknown>) => { run.state = AgentRunState.Completed; },
			(run: Record<string, unknown>) => { run.attempt = 2; },
		])
		{
			const fixture = _Fixture(AgentServiceKind.Managed);
			const reserved = await fixture.authority.reserve(_reserveCommand());
			if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
				throw new Error("fixture did not reserve");
			change(fixture.state.run);
			await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-1"))).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Cancelled });
		}
		const expired = _Fixture(AgentServiceKind.Managed);
		const reserved = await expired.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		await expect(expired.authority.claim({ ..._attempt(reserved.reservation, "nonce-1"), deadlineEpochMs: 1_950_000_000_000 })).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Cancelled });
	});

	it("uses the authenticated pre-forward receipt to restore capacity for a new nonce", async function _PreForwardRetry()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		await fixture.authority.releasePreForward({ ...attempt, receipt: _receipt(reserved.reservation.logicalFence, attempt) });
		expect(fixture.state.effects[0]?.state).toBe(ManagedBudgetEffectState.Reserved);
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-2"))).resolves.toMatchObject({ mayDispatch: true, state: ManagedMonthlyBudgetReservationStates.Claimed });
	});

	it("settles known usage below the hold and records the exact charge", async function _KnownSettlement()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		await expect(fixture.authority.settle({ ...attempt, usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 10, outputTokens: 5 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.Settled, actualEurMicros: "20" });
		expect(fixture.state.accounts[0]?.settledEurMicros).toBe(20n);
		expect(fixture.state.accounts[0]?.claimedEurMicros).toBe(0n);
		expect(fixture.state.accounts.map(account => account.settledEurMicros)).toEqual([20n, 20n]);
	});

	it("retains the full worst-case liability when usage is unknown", async function _UnknownSettlement()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		await expect(fixture.authority.retainUnknown(attempt)).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.Unknown, admissionClosed: false });
		expect(fixture.state.accounts[0]?.unknownEurMicros).toBe(300n);
		expect(fixture.state.accounts[0]?.claimedEurMicros).toBe(0n);
		expect(fixture.state.accounts.map(account => account.unknownEurMicros)).toEqual([300n, 300n]);
	});

	it("stores representable above-bound usage as a price-integrity breach, not unknown liability", async function _RepresentableBreach()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		await expect(fixture.authority.settle({ ...attempt, usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 100, outputTokens: 101 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.PriceIntegrityBreach, actualEurMicros: "302", admissionClosed: true });
		expect(fixture.state.accounts[0]?.settledEurMicros).toBe(302n);
		expect(fixture.state.accounts[0]?.unknownEurMicros).toBe(0n);
		expect(fixture.state.accounts[0]?.admissionClosedAt).toEqual(NOW);
	});

	it("does not dispatch a stale reservation when a new assistant policy becomes applicable", async function _NewPolicyCoverage()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		fixture.state.policies.push(fixture.state.optionalPolicy);
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-1"))).resolves.toMatchObject({ mayDispatch: true, state: ManagedMonthlyBudgetReservationStates.Claimed });
		expect(fixture.state.accounts.find(account => account.policyId === fixture.state.optionalPolicy.id)?.claimedEurMicros).toBe(300n);
		expect(new Set(fixture.state.effects[0]?.impactAccountIds as string[]).size).toBe(3);
	});

	it("rechecks lowered current policy capacity before physical dispatch", async function _LoweredPolicy()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		for (const policy of fixture.state.policies)
			policy.limitEurMicros = 299n;
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-1"))).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Reserved, admissionClosed: false });
	});

	it("accounts every scope once when two reserved effects race with a lowered cap", async function _TwoEffectsCloseCapacity()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		for (const policy of fixture.state.policies)
			policy.limitEurMicros = 600n;
		for (const account of fixture.state.accounts)
			account.limitEurMicros = 600n;
		const first = await fixture.authority.reserve(_reserveCommand("1"));
		const second = await fixture.authority.reserve(_reserveCommand("2"));
		if (first.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved || second.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve two effects");
		await fixture.authority.claim(_attempt(first.reservation, "nonce-1"));
		for (const policy of fixture.state.policies)
			policy.limitEurMicros = 300n;
		await expect(fixture.authority.settle({ ..._attempt(first.reservation, "nonce-1"), usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 100, outputTokens: 100 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.Settled, actualEurMicros: "300", admissionClosed: true });
		await expect(fixture.authority.claim(_attempt(second.reservation, "nonce-2"))).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Cancelled, admissionClosed: true });
	});

	it("supports exact-cap no-forward retry and cheaper-known refund", async function _CapRecovery()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		for (const policy of fixture.state.policies)
			policy.limitEurMicros = 300n;
		for (const account of fixture.state.accounts)
			account.limitEurMicros = 300n;
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const firstAttempt = _attempt(reserved.reservation, "nonce-1");
		await expect(fixture.authority.claim(firstAttempt)).resolves.toMatchObject({ mayDispatch: true });
		await fixture.authority.releasePreForward({ ...firstAttempt, receipt: _receipt(reserved.reservation.logicalFence, firstAttempt) });
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-2"))).resolves.toMatchObject({ mayDispatch: true });

		const cheaper = _Fixture(AgentServiceKind.Managed);
		for (const policy of cheaper.state.policies)
			policy.limitEurMicros = 300n;
		for (const account of cheaper.state.accounts)
			account.limitEurMicros = 300n;
		const cheaperReservation = await cheaper.authority.reserve(_reserveCommand());
		if (cheaperReservation.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve cheaper settlement");
		const cheaperAttempt = _attempt(cheaperReservation.reservation, "nonce-1");
		await cheaper.authority.claim(cheaperAttempt);
		await expect(cheaper.authority.settle({ ...cheaperAttempt, usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 10, outputTokens: 5 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.Settled, actualEurMicros: "20", admissionClosed: false });
		await expect(cheaper.authority.reserve(_reserveCommand("2", _tariff(), 10))).resolves.toMatchObject({ kind: ManagedMonthlyBudgetReserveResultKinds.Reserved });
	});

	it("retains exact token evidence when the computed price exceeds signed bigint storage", async function _BigIntOverflow()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		for (const policy of fixture.state.policies)
			policy.limitEurMicros = MAX_SIGNED_BIGINT;
		for (const account of fixture.state.accounts)
			account.limitEurMicros = MAX_SIGNED_BIGINT;
		const highTariff = _tariff({ inputEurMicrosPerUnit: "9223372036854775807", outputEurMicrosPerUnit: "0" });
		fixture.state.tariff = _tariffRow(highTariff);
		const reserved = await fixture.authority.reserve(_reserveCommand("3", highTariff));
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve overflow effect");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		await expect(fixture.authority.settle({ ...attempt, usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 2_147_483_647, outputTokens: 0 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.PriceIntegrityBreach, admissionClosed: true });
		expect(fixture.state.effects[0]?.actualInputTokens).toBe(2_147_483_647n);
		expect(fixture.state.effects[0]?.actualOutputTokens).toBe(0n);
		expect(String(fixture.state.effects[0]?.worstCaseEurMicros)).toBe(reserved.reservation.worstCaseEurMicros);
	});

	it("cancels an undispatched hold when its tariff expires before claim", async function _ExpiredTariff()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		fixture.state.now = new Date("2027-01-01T00:00:00.000Z");
		await expect(fixture.authority.claim(_attempt(reserved.reservation, "nonce-1"))).resolves.toMatchObject({ mayDispatch: false, state: ManagedMonthlyBudgetReservationStates.Cancelled, admissionClosed: false });
	});

	it("settles an already-claimed request even after the run reaches a terminal state", async function _SettlementAfterTermination()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		const attempt = _attempt(reserved.reservation, "nonce-1");
		await fixture.authority.claim(attempt);
		fixture.state.run.state = AgentRunState.Completed;
		await expect(fixture.authority.settle({ ...attempt, usage: { kind: ConversationModelUsageKinds.Known, inputTokens: 10, outputTokens: 5 } })).resolves.toMatchObject({ state: ManagedMonthlyBudgetReservationStates.Settled, actualEurMicros: "20" });
	});

	it("uses the database clock month after a UTC rollover", async function _MonthRollover()
	{
		const fixture = _Fixture(AgentServiceKind.Managed);
		fixture.state.now = new Date("2026-10-01T00:00:00.000Z");
		const reserved = await fixture.authority.reserve(_reserveCommand());
		if (reserved.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("fixture did not reserve");
		expect(reserved.reservation.periodStart).toBe("2026-10-01T00:00:00.000Z");
		expect(fixture.state.accounts.some(account => account.periodStart instanceof Date && account.periodStart.toISOString() === "2026-10-01T00:00:00.000Z")).toBe(true);
	});
});

function _Fixture(kind: AgentServiceKind): Fixture
{
	const periodStart = new Date("2026-09-01T00:00:00.000Z");
	const globalPolicy = _policy("policy-global", ManagedBudgetScope.Global, "global", null, null, 10_000n);
	const groupPolicy = _policy("policy-group", ManagedBudgetScope.Group, "group-1", "group-1", null, 10_000n);
	const optionalPolicy = _policy("policy-service", ManagedBudgetScope.AgentService, "service-1", null, "service-1", 10_000n);
	const account = (policy: Record<string, unknown>, id: string) => ({ id, siloId: "silo-1", policyId: policy.id, periodStart, policyRevision: 1, limitEurMicros: policy.limitEurMicros, settledEurMicros: 0n, unknownEurMicros: 0n, claimedEurMicros: 0n, reservedEurMicros: 0n, revision: 0, admissionClosedAt: null, policy });
	const accounts = [account(globalPolicy, "account-global"), account(groupPolicy, "account-group")];
	const state = {
		now: NOW, tariff: _tariffRow(), run: _run(kind), policies: [globalPolicy, groupPolicy], accounts, effects: [] as Record<string, unknown>[], attempts: [] as Record<string, unknown>[], optionalPolicy,
	};
	const effectRecord = (effect: Record<string, unknown> | undefined) => {
		if (effect === undefined)
			return null;
		const impactAccountIds = effect.impactAccountIds as string[];
		return { ...effect, tariff: state.tariff, attempts: state.attempts.filter(value => value.effectId === effect.id), impacts: state.accounts.filter(value => impactAccountIds.includes(String(value.id))).map(value => ({ effectId: effect.id, accountId: value.id, siloId: "silo-1", account: value })) };
	};
	const transaction = {
		agentRunAuthorityClock: { findUniqueOrThrow: async () => ({ now: state.now }) },
		agentRun: { findUnique: async () => ({ ...state.run }) },
		runInputSnapshot: { findUnique: async () => ({ runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION, origin: { kind: "interactive", messageId: null, historyRevision: null }, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, modelRoute: { alias: "model-1", maxOutputTokens: null }, mcpTools: [], firstPartyCapabilities: [], budgetPolicy: { maxModelTurns: 1, maxCompletionTokens: 100, maxCostUsdMicros: null, maxToolInvocations: 0, maxLoopIterations: 1, wallClockDeadlineEpochMs: 1_900_000_000_000 }, promptCompilerVersion: "prompt-v1", executionSubject: _subject(true), agentIdentityId: "identity-1", principalId: "principal-1", digest: state.run.inputSnapshotDigest, compiledAt: NOW }) },
		modelEurTariffRevision: { findUnique: async () => state.tariff },
		managedBudgetPolicy: { findMany: async (query: { where?: { id?: { in: string[] } } }) => { const ids = query.where?.id?.in; return ids === undefined ? state.policies : state.policies.filter(value => ids.includes(String(value.id))); } },
		managedBudgetPolicyFence: { upsert: async () => ({}) },
		managedBudgetMonthlyAccount: {
			upsert: async ({ where, create, update }: { where: { policyId_periodStart: { policyId: string; periodStart: Date } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
				let found = state.accounts.find(value => value.policyId === where.policyId_periodStart.policyId && value.periodStart instanceof Date && value.periodStart.getTime() === where.policyId_periodStart.periodStart.getTime());
				if (found === undefined)
				{
						const policy = state.policies.find(value => value.id === create.policyId);
						if (policy === undefined)
							throw new Error("policy missing");
						const createdAccount = { ...create, id: `account-${String(create.policyId)}`, settledEurMicros: 0n, unknownEurMicros: 0n, claimedEurMicros: 0n, reservedEurMicros: 0n, revision: 0, admissionClosedAt: null, policy } as typeof state.accounts[number];
						found = createdAccount;
						state.accounts.push(createdAccount);
					}
					if (found === undefined)
						throw new Error("account missing");
					_apply(found, update);
				return found;
			},
			update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const value = state.accounts.find(candidate => candidate.id === where.id);
				if (value === undefined)
					throw new Error("account missing");
				_apply(value, data);
				return value;
			},
		},
			managedBudgetEffect: {
				findUnique: async ({ where }: { where: { id?: string; runId_logicalFence?: { runId: string; logicalFence: string } } }) => {
					const logicalFence = where.runId_logicalFence;
					if (where.id === undefined && logicalFence === undefined)
						throw new Error("effect lookup missing coordinates");
					const effect = where.id === undefined ? state.effects.find(value => value.runId === logicalFence!.runId && value.logicalFence === logicalFence!.logicalFence) : state.effects.find(value => value.id === where.id);
				return effectRecord(effect);
			},
			findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
				const value = effectRecord(state.effects.find(effect => effect.id === where.id));
				if (value === null)
					throw new Error("effect missing");
				return value;
			},
			create: async ({ data }: { data: Record<string, unknown> }) => {
				const impacts = data.impacts as { create: Array<{ accountId: string }> };
				const effect = { ...data, id: `effect-${state.effects.length + 1}`, impactAccountIds: impacts.create.map(value => value.accountId), state: ManagedBudgetEffectState.Reserved, actualEurMicros: null, actualInputTokens: null, actualOutputTokens: null, terminalAt: null };
				state.effects.push(effect);
				return effectRecord(effect);
			},
			update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const effect = state.effects.find(value => value.id === where.id);
				if (effect === undefined)
					throw new Error("effect missing");
				_apply(effect, data);
				return effectRecord(effect);
			},
		},
		managedBudgetPhysicalAttempt: {
			create: async ({ data }: { data: Record<string, unknown> }) => {
				const attempt = { ...data, id: `attempt-${state.attempts.length + 1}`, state: ManagedBudgetAttemptState.Claimed, terminalAt: null };
				state.attempts.push(attempt);
				return attempt;
			},
			update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const attempt = state.attempts.find(value => value.id === where.id);
				if (attempt === undefined)
					throw new Error("attempt missing");
				_apply(attempt, data);
				return attempt;
			},
		},
		managedBudgetScopeImpact: { create: async ({ data }: { data: { effectId: string; accountId: string } }) => {
			const effect = state.effects.find(value => value.id === data.effectId);
			if (effect === undefined)
				throw new Error("effect missing");
			(effect.impactAccountIds as string[]).push(data.accountId);
			return data;
		} },
	};
	const prisma = { $transaction: async (work: (value: unknown) => Promise<unknown>) => work(transaction) };
	return { authority: new PrismaManagedMonthlyBudgetUnitOfWork(prisma as never), state };
}

function _run(kind: AgentServiceKind): Record<string, unknown>
{
	const managed = kind === AgentServiceKind.Managed;
	const payer = managed ? { payingGroupId: "group-1", payingGroupAuthorizationDecisionDigest: "decision", payingGroupAuthorizationPolicyRevisionHash: "policy-revision", payingGroupEffectiveAuthorizationDigest: "effective" } : { payingGroupId: null, payingGroupAuthorizationDecisionDigest: null, payingGroupAuthorizationPolicyRevisionHash: null, payingGroupEffectiveAuthorizationDigest: null };
	return {
		id: "run-1", siloId: "silo-1", attempt: 1, agentServiceId: "service-1", inputSnapshotDigest: "snapshot-1", ...payer,
		service: { kind }, executionSubject: _subject(managed), state: AgentRunState.Running,
	};
}

function _subject(managed: boolean): Record<string, unknown>
{
	const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
	return {
		schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: digest("a"), decisionEvidenceId: "identity", verifiedAt: "2026-09-01T00:00:00.000Z" },
		membership: managed ? { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "principal-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: digest("b"), decisionEvidenceId: "managed", trustedUntil: "2099-09-01T00:00:00.000Z" } : { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "fleet", payloadDigest: digest("b"), decisionEvidenceId: "fleet", trustedUntil: "2099-09-01T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: digest("c"), effectiveContractDigest: digest("d"), decisionEvidenceId: "capability", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request", authenticatedAt: "2026-09-01T00:00:00.000Z", membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "requester-1", siloId: "silo-1", revision: 1, assertionId: "requester", payloadDigest: digest("e"), decisionEvidenceId: "requester", trustedUntil: "2099-09-01T00:00:00.000Z" } }, admission: { authorizingPrincipalId: "requester-1", decisionEvidenceId: "admission", admittedAt: "2026-09-01T00:00:00.000Z" },
	};
}

function _policy(id: string, scope: ManagedBudgetScope, scopeKey: string, groupId: string | null, agentServiceId: string | null, limitEurMicros: bigint): Record<string, unknown>
{
	return { id, siloId: "silo-1", scope, scopeKey, groupId, agentServiceId, limitEurMicros, revision: 1, updatedAt: NOW };
}

function _tariff(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	const identity = { version: 1 as const, modelAlias: "model-1", currency: "EUR" as const, inputEurMicrosPerUnit: "1000000", outputEurMicrosPerUnit: "2000000", tokenUnit: 1_000_000 as const, maxInputTokens: 100, revision: 1, effectiveAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", ...overrides };
	return { ...identity, digest: ___DigestCanonicalJson(identity) };
}

function _tariffRow(tariff: Record<string, unknown> = _tariff()): Record<string, unknown>
{
	return { id: "tariff-1", siloId: "silo-1", modelDefinitionId: "model-definition-1", revision: tariff.revision, digest: tariff.digest, tokenUnit: BigInt(tariff.tokenUnit as number), maxInputTokens: tariff.maxInputTokens, inputEurMicrosPerUnit: BigInt(tariff.inputEurMicrosPerUnit as string), outputEurMicrosPerUnit: BigInt(tariff.outputEurMicrosPerUnit as string), effectiveAt: new Date(String(tariff.effectiveAt)), validUntil: new Date(String(tariff.validUntil)), modelDefinition: { publicModelName: "model-1" } };
}

function _quote(maxCompletionTokens: number, tariff = _tariff()): Record<string, unknown>
{
	const input = BigInt(tariff.inputEurMicrosPerUnit as string);
	const output = BigInt(tariff.outputEurMicrosPerUnit as string);
	const worstCaseEurMicros = ((100n * input) + (BigInt(maxCompletionTokens) * output) + 999_999n) / 1_000_000n;
	return { tariff, maxCompletionTokens, worstCaseEurMicros: worstCaseEurMicros.toString() };
}

function _reserveCommand(suffix = "1", tariff = _tariff(), maxCompletionTokens = 100): any
{
	return { siloId: "silo-1", runId: "run-1", runAttempt: 1, logicalFence: suffix.repeat(64), modelAlias: "model-1", maxCompletionTokens, quote: _quote(maxCompletionTokens, tariff) };
}

function _attempt(reservation: any, physicalNonce: string): any
{
	const nonce = physicalNonce.endsWith("1") ? "1" : "2";
	return { reservation, physicalNonce: nonce.repeat(64), requestBodySha256: BODY_DIGEST, deadlineEpochMs: 1_800_000_000_000 };
}

function _receipt(logicalFence: string, attempt: any): any
{
	return { version: ConversationModelPreForwardContracts.V1, physicalNonce: attempt.physicalNonce, logicalFence, requestBodySha256: attempt.requestBodySha256, deadlineEpochMs: attempt.deadlineEpochMs, retryAtEpochMs: attempt.deadlineEpochMs - 1_000, reason: ConversationModelPreForwardReasons.LocalRateLimit };
}

function _apply(target: Record<string, unknown>, data: Record<string, unknown>): void
{
	for (const [key, value] of Object.entries(data))
	{
		if (typeof value === "object" && value !== null && ("increment" in value || "decrement" in value))
		{
			const delta = BigInt((value as { increment?: bigint; decrement?: bigint }).increment ?? (value as { decrement?: bigint }).decrement!);
			target[key] = BigInt(target[key] as bigint) + ("increment" in value ? delta : -delta);
		}
		else
			target[key] = value;
	}
}
