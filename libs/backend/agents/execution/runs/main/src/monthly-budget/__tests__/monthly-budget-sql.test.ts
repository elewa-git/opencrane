import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaManagedMonthlyBudgetUnitOfWork } from "../prisma-managed-monthly-budget-unit-of-work";
import { ManagedMonthlyBudgetReserveResultKinds } from "../monthly-budget.types";

/** An ordinary test run must never connect merely because DATABASE_URL exists. */
const _QUALIFICATION_ENABLED = process.env.OPENCRANE_MONTHLY_BUDGET_SQL === "1";
/** The caller must point this opt-in at a fresh, task-owned PostgreSQL baseline. */
const _QUALIFICATION_DATABASE_URL = process.env.OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL;
const _suite = _QUALIFICATION_ENABLED ? describe : describe.skip;

interface SqlFixture
{
	readonly siloId: string;
	readonly serviceId: string;
	readonly modelId: string;
	readonly groupId: string;
	readonly runIds: readonly string[];
	readonly clients: readonly [PrismaClient, PrismaClient];
}

const _suiteName = "managed monthly-budget PostgreSQL concurrency qualification";

_suite(_suiteName, function _Suite()
{
	let fixture: SqlFixture;

	beforeEach(async function _ConnectAndSeed()
	{
		fixture = await _CreateFixture();
	});

	afterEach(async function _Disconnect()
	{
		if (fixture === undefined)
			return;
		await Promise.all(fixture.clients.map(client => client.$disconnect()));
	});

	it("admits at most one of two reservations against the same global and group capacity", async function _CompetingReservations()
	{
		const [firstClient, secondClient] = fixture.clients;
		expect(new Set(await Promise.all(fixture.clients.map(async client => (await client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]?.pid))).size).toBe(2);
		const first = _Authority(firstClient).reserve(_ReserveCommand(fixture, fixture.runIds[0], "reserve-1"));
		const second = _Authority(secondClient).reserve(_ReserveCommand(fixture, fixture.runIds[1], "reserve-2"));
		const results = await Promise.all([first, second]);
		const reserved = results.filter(result => result.kind === ManagedMonthlyBudgetReserveResultKinds.Reserved);
		const insufficient = results.filter(result => result.kind === ManagedMonthlyBudgetReserveResultKinds.InsufficientCapacity);
		expect(reserved).toHaveLength(1);
		expect(insufficient).toHaveLength(1);
		expect(await firstClient.managedBudgetEffect.count({ where: { siloId: fixture.siloId } })).toBe(1);
		const accounts = await firstClient.managedBudgetMonthlyAccount.findMany({ where: { siloId: fixture.siloId } });
		expect(accounts).toHaveLength(3);
		expect(accounts.every(account => account.reservedEurMicros === 2n)).toBe(true);
	}, 30_000);

	it("authorizes at most one physical dispatch for one concurrent claim", async function _CompetingClaims()
	{
		const [firstClient, secondClient] = fixture.clients;
		expect(new Set(await Promise.all(fixture.clients.map(async client => (await client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]?.pid))).size).toBe(2);
		const reservationResult = await _Authority(firstClient).reserve(_ReserveCommand(fixture, fixture.runIds[0], "claim-1"));
		if (reservationResult.kind !== ManagedMonthlyBudgetReserveResultKinds.Reserved)
			throw new Error("The claim fixture did not reserve");
		const reservation = reservationResult.reservation;
		const command = { reservation, physicalNonce: "1".repeat(64), requestBodySha256: "2".repeat(64), deadlineEpochMs: 4_102_444_800_000 };
		const results = await Promise.all([_Authority(firstClient).claim(command), _Authority(secondClient).claim(command)]);
		expect(results.filter(result => result.mayDispatch)).toHaveLength(1);
		expect(results.filter(result => !result.mayDispatch)).toHaveLength(1);
		expect(await firstClient.managedBudgetPhysicalAttempt.count({ where: { effectId: reservation.effectId } })).toBe(1);
	}, 30_000);
});

function _Authority(client: PrismaClient): PrismaManagedMonthlyBudgetUnitOfWork
{
	return new PrismaManagedMonthlyBudgetUnitOfWork(client);
}

function _ReserveCommand(fixture: SqlFixture, runId: string, logicalFence: string)
{
	const tariff = {
		version: 1 as const,
		modelAlias: fixture.modelId,
		currency: "EUR" as const,
		inputEurMicrosPerUnit: "5",
		outputEurMicrosPerUnit: "10",
		tokenUnit: 1_000_000 as const,
		maxInputTokens: 100_000,
		revision: 1,
		effectiveAt: "2020-01-01T00:00:00.000Z",
		validUntil: "2099-01-01T00:00:00.000Z",
	};
	return {
		siloId: fixture.siloId,
		runId,
		runAttempt: 1,
		logicalFence: _Digest(logicalFence),
		modelAlias: fixture.modelId,
		maxCompletionTokens: 100_000,
		quote: { tariff: { ...tariff, digest: ___DigestCanonicalJson(tariff) }, maxCompletionTokens: 100_000, worstCaseEurMicros: "2" },
	};
}

async function _CreateFixture(): Promise<SqlFixture>
{
	if (_QUALIFICATION_DATABASE_URL === undefined)
		throw new Error("SQL qualification requires OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL for a fresh task-owned baseline");
	const clients: [PrismaClient, PrismaClient] = [new PrismaClient({ datasources: { db: { url: _QUALIFICATION_DATABASE_URL } } }), new PrismaClient({ datasources: { db: { url: _QUALIFICATION_DATABASE_URL } } })];
	try
	{
		await Promise.all(clients.map(client => client.$connect()));
		const fixture = { siloId: `budget-sql-${randomUUID()}`, serviceId: `budget-sql-${randomUUID()}`, modelId: `budget-sql-${randomUUID()}`, groupId: `budget-sql-${randomUUID()}`, runIds: [`budget-sql-${randomUUID()}`, `budget-sql-${randomUUID()}`, `budget-sql-${randomUUID()}`] as const, clients };
		await _Seed(fixture);
		return fixture;
	}
	catch (error)
	{
		await Promise.all(clients.map(client => client.$disconnect()));
		throw error;
	}
}

async function _Seed(fixture: SqlFixture): Promise<void>
{
	if (_QUALIFICATION_DATABASE_URL === undefined)
		throw new Error("SQL qualification requires OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL");
	const setup = new Client({ connectionString: _QUALIFICATION_DATABASE_URL });
	await setup.connect();
	try
	{
		await setup.query(await readFile(new URL("../../../../../../../../../scripts/sql/authority-fixtures.sql", import.meta.url), "utf8"));
		await setup.query("BEGIN");
		await setup.query("SELECT pg_temp.seed_silo_model($1, $2)", [fixture.siloId, fixture.modelId]);
		await setup.query("SELECT pg_temp.seed_managed_service($1, $2, $3, $4)", [fixture.siloId, fixture.serviceId, fixture.modelId, `${fixture.serviceId}-revision`]);
		await setup.query("INSERT INTO groups (id, silo_id, name, membership_authority) VALUES ($1, $2, $3, 'local')", [fixture.groupId, fixture.siloId, fixture.groupId]);
		for (const runId of fixture.runIds)
		{
			const digest = `sha256:${createHash("sha256").update(runId).digest("hex")}`;
			const conversationId = `${runId}-conversation`;
			const subject = JSON.stringify(_Subject(fixture, runId));
			await setup.query("SELECT pg_temp.seed_agent_conversation($1, $2, $3)", [conversationId, fixture.siloId, fixture.serviceId]);
			await setup.query("INSERT INTO agent_runs (id, silo_id, agent_service_id, agent_revision_id, conversation_id, trigger, agent_identity_id, principal_id, paying_group_id, paying_group_authorization_decision_digest, paying_group_authorization_policy_revision_hash, paying_group_effective_authorization_digest, execution_subject, request_idempotency_key, input_snapshot_digest) VALUES ($1, $2, $3, $4, $5, 'interactive', $6, $7, $8, $9, $10, $11, $12::jsonb, $1, $13)", [runId, fixture.siloId, fixture.serviceId, `${fixture.serviceId}-revision`, conversationId, `${runId}-identity`, `${fixture.serviceId}-principal`, fixture.groupId, "sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64), "sha256:" + "c".repeat(64), subject, digest]);
			await setup.query("INSERT INTO run_input_snapshots (id, run_id, attempt, snapshot_version, origin, silo_id, agent_service_id, agent_revision_id, agent_identity_id, principal_id, execution_subject, conversation_id, model_route, mcp_tools, memory_query_policy, budget_policy, prompt_compiler_version, input_digest) VALUES ($1, $2, 1, 4, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, '[]'::jsonb, '{}'::jsonb, $12::jsonb, 'prompt-v1', $13)", [`${runId}-snapshot`, runId, JSON.stringify({ kind: "interactive", messageId: null, historyRevision: null }), fixture.siloId, fixture.serviceId, `${fixture.serviceId}-revision`, `${runId}-identity`, `${fixture.serviceId}-principal`, subject, conversationId, JSON.stringify({ alias: fixture.modelId, maxOutputTokens: null }), JSON.stringify({ maxModelTurns: 1, maxCompletionTokens: 100_000, maxCostUsdMicros: null, maxToolInvocations: 1, maxLoopIterations: 1, wallClockDeadlineEpochMs: 4_102_444_800_000 }), digest]);
			await setup.query("UPDATE agent_runs SET state = 'running', started_at = clock_timestamp() WHERE id = $1", [runId]);
		}
		const tariff = { version: 1 as const, modelAlias: fixture.modelId, currency: "EUR" as const, inputEurMicrosPerUnit: "5", outputEurMicrosPerUnit: "10", tokenUnit: 1_000_000 as const, maxInputTokens: 100_000, revision: 1, effectiveAt: "2020-01-01T00:00:00.000Z", validUntil: "2099-01-01T00:00:00.000Z" };
		await setup.query("INSERT INTO model_eur_tariff_revisions (id, silo_id, model_definition_id, revision, digest, token_unit, max_input_tokens, input_eur_micros_per_unit, output_eur_micros_per_unit, effective_at, valid_until) VALUES ($1, $2, $3, 1, $4, 1000000, 100000, 5, 10, TIMESTAMPTZ '2020-01-01 00:00:00+00', TIMESTAMPTZ '2099-01-01 00:00:00+00')", [`${fixture.modelId}-tariff`, fixture.siloId, fixture.modelId, ___DigestCanonicalJson(tariff)]);
		for (const [id, scope, scopeKey, groupId, agentServiceId] of [[`${fixture.groupId}-global`, "global", "global", null, null], [`${fixture.groupId}-group`, "group", fixture.groupId, fixture.groupId, null], [`${fixture.groupId}-service`, "agent_service", fixture.serviceId, null, fixture.serviceId]] as const)
		{
			await setup.query("INSERT INTO managed_budget_policies (id, silo_id, scope, scope_key, group_id, agent_service_id, limit_eur_micros, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 2, clock_timestamp())", [id, fixture.siloId, scope, scopeKey, groupId, agentServiceId]);
			await setup.query("INSERT INTO managed_budget_policy_fences (policy_id, revision) VALUES ($1, 0)", [id]);
		}
		await setup.query("COMMIT");
	}
	catch (error)
	{
		await setup.query("ROLLBACK");
		throw error;
	}
	finally { await setup.end(); }
}

function _Subject(fixture: Pick<SqlFixture, "siloId" | "serviceId">, runId: string): Record<string, unknown>
{
	const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
	return { schemaVersion: 1, siloId: fixture.siloId, agentIdentityId: `${runId}-identity`, principalId: `${fixture.serviceId}-principal`, identity: { agentIdentityId: `${runId}-identity`, principalId: `${fixture.serviceId}-principal`, siloId: fixture.siloId, headRevision: "1", headDigest: digest("a"), decisionEvidenceId: "identity", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { kind: "managed", principalId: `${fixture.serviceId}-principal`, siloId: fixture.siloId, agentServiceId: fixture.serviceId, agentRevisionId: `${fixture.serviceId}-revision`, agentRevisionDigest: digest("b"), decisionEvidenceId: "managed", trustedUntil: "2099-09-01T00:00:00.000Z" }, capability: { agentIdentityId: `${runId}-identity`, computerId: `${runId}-computer`, capabilitySetDigest: digest("c"), effectiveContractDigest: digest("d"), decisionEvidenceId: "capability", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: fixture.siloId, runId, attempt: 1, agentServiceId: fixture.serviceId, agentRevisionId: `${fixture.serviceId}-revision` }, computerScope: { siloId: fixture.siloId, computerId: `${runId}-computer`, leaseId: `${runId}-lease`, leaseGeneration: 1 }, requester: { siloId: fixture.siloId, requesterPrincipalId: `${fixture.serviceId}-principal`, requestIdempotencyKey: runId, authenticatedAt: "2026-09-01T00:00:00.000Z", membership: { kind: "fleet", principalId: `${fixture.serviceId}-principal`, siloId: fixture.siloId, revision: 1, assertionId: "requester", payloadDigest: digest("e"), decisionEvidenceId: "requester", trustedUntil: "2099-09-01T00:00:00.000Z" } }, admission: { authorizingPrincipalId: `${fixture.serviceId}-principal`, decisionEvidenceId: "admission", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

function _Digest(value: string): string
{
	return createHash("sha256").update(value).digest("hex");
}
