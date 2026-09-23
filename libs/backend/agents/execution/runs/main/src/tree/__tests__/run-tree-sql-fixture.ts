import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { type Prisma, type PrismaClient } from "@prisma/client";
import { Client } from "pg";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaRunTreeRepository } from "../prisma-run-tree-repository";
import type { RunTreeSqlFixture, RunTreeSqlOperation, RunTreeSqlSignal } from "./run-tree-sql-fixture.types";

/**
 * Creates trigger-valid accepted runs in the disposable CI database, with no live grants or effects.
 * These rows remain until CI tears down its database. No constraints or triggers are disabled.
 */
export async function _SeedRunTreeSqlFixture(runCount: number): Promise<RunTreeSqlFixture>
{
	const prefix = `tree-proof-${randomUUID()}`;
	const fixture: RunTreeSqlFixture = { siloId: `${prefix}-silo`, serviceId: `${prefix}-service`, revisionId: `${prefix}-revision`, modelId: `${prefix}-model`, requesterId: `${prefix}-requester`, deadlineAt: new Date(Date.now() + 3_600_000), runIds: Array.from({ length: runCount }, function _RunId(_, index) { return `${prefix}-run-${index}`; }) };
	const setup = new Client({ connectionString: process.env.DATABASE_URL });
	await setup.connect();
	try
	{
		await setup.query(await readFile(new URL("../../../../../../../../../scripts/sql/authority-fixtures.sql", import.meta.url), "utf8"));
		await setup.query("BEGIN");
		await setup.query("SELECT pg_temp.seed_silo_model($1, $2)", [fixture.siloId, fixture.modelId]);
		await setup.query("SELECT pg_temp.seed_external_user($1, $2)", [fixture.siloId, fixture.requesterId]);
		await setup.query("SELECT pg_temp.seed_managed_service($1, $2, $3, $4)", [fixture.siloId, fixture.serviceId, fixture.modelId, fixture.revisionId]);
		for (const runId of fixture.runIds)
		{
			const subject = { runScope: { runId, attempt: 1 }, requester: { requesterPrincipalId: fixture.requesterId } };
			const budget = { maxModelTurns: 100, maxCompletionTokens: 1000, maxToolInvocations: 100, maxLoopIterations: 100, maxCostUsdMicros: 1_000_000, wallClockDeadlineEpochMs: fixture.deadlineAt.getTime() };
			const digest = `sha256:${createHash("sha256").update(runId).digest("hex")}`;
			await setup.query("SELECT pg_temp.seed_agent_conversation($1, $2, $3)", [`${runId}-conversation`, fixture.siloId, fixture.serviceId]);
			await setup.query("INSERT INTO agent_runs (id, silo_id, agent_service_id, agent_revision_id, conversation_id, trigger, agent_identity_id, principal_id, execution_subject, request_idempotency_key, input_snapshot_digest, workflow_task_id, workflow_task_name, workflow_task_key) VALUES ($1, $2, $3, $4, $5, 'interactive', $6, $7, $8::jsonb, $1, $9, $10, 'conversation-computer-turn', $11)", [runId, fixture.siloId, fixture.serviceId, fixture.revisionId, `${runId}-conversation`, `${runId}-identity`, `${fixture.serviceId}-principal`, JSON.stringify(subject), digest, randomUUID(), randomUUID()]);
			await setup.query("INSERT INTO run_input_snapshots (id, run_id, attempt, snapshot_version, silo_id, agent_service_id, agent_revision_id, agent_identity_id, principal_id, execution_subject, conversation_id, model_route, mcp_tools, memory_query_policy, budget_policy, prompt_compiler_version, input_digest) VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8::jsonb, $9, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $10::jsonb, 'prompt-v1', $11)", [`${runId}-snapshot`, runId, fixture.siloId, fixture.serviceId, fixture.revisionId, `${runId}-identity`, `${fixture.serviceId}-principal`, JSON.stringify(subject), `${runId}-conversation`, JSON.stringify(budget), digest]);
		}
		await setup.query("COMMIT");
		return fixture;
	}
	catch (error)
	{
		await setup.query("ROLLBACK");
		throw error;
	}
	finally { await setup.end(); }
}

/** Runs actual repository methods through the production whole-transaction rollback classifier. */
export function _RunTreeSqlCommand<Result>(client: PrismaClient, operation: RunTreeSqlOperation<Result>): Promise<Result>
{
	return ___RunInPrismaUnitOfWork(client, async function _Run(transaction)
	{
		const repository = new PrismaRunTreeRepository(transaction);
		return operation(transaction, repository);
	}, { isolationLevel: "Serializable", attemptLimit: 3, timeout: 10_000, maxWait: 10_000, operation: "run-tree SQL concurrency proof" });
}

/** Creates a checkpoint without relying on connection scheduling or arbitrary delays. */
function _signal(): RunTreeSqlSignal
{
	let resolve!: RunTreeSqlSignal["resolve"];
	let reject!: RunTreeSqlSignal["reject"];
	const promise = new Promise<void>(function _Wait(onResolve, onReject) { resolve = onResolve; reject = onReject; });
	return { promise, resolve, reject };
}

/**
 * Holds the first write open while the second connection establishes a Serializable snapshot.
 * The second operation then competes against the uncommitted winner and retries as a whole when
 * PostgreSQL rejects its old snapshot. Different backend PIDs prove that no connection is shared.
 */
export async function _OverlapRunTreeSqlCommands<First, Second>(firstClient: PrismaClient, secondClient: PrismaClient, probeRunId: string, firstOperation: RunTreeSqlOperation<First>, secondOperation: RunTreeSqlOperation<Second>)
{
	const firstWritten = _signal();
	const secondObserved = _signal();
	const backendPids = new Set<number>();
	let secondAttempts = 0;
	const first = _RunTreeSqlCommand(firstClient, async function _First(transaction, repository)
	{
		try
		{
			const [{ pid }] = await transaction.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
			backendPids.add(pid);
			const result = await firstOperation(transaction, repository);
			firstWritten.resolve();
			await secondObserved.promise;
			return result;
		}
		catch (error) { firstWritten.reject(error); throw error; }
	});
	const second = _RunTreeSqlCommand(secondClient, async function _Second(transaction, repository)
	{
		secondAttempts += 1;
		try
		{
			await firstWritten.promise;
			const [{ pid }] = await transaction.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
			backendPids.add(pid);
			await transaction.agentRun.findUniqueOrThrow({ where: { id: probeRunId } });
			secondObserved.resolve();
			return secondOperation(transaction, repository);
		}
		finally { secondObserved.resolve(); }
	});
	const results = await Promise.allSettled([first, second]);
	return { results, backendPids: [...backendPids], secondAttempts };
}

/** Stores synthetic, trigger-checked requester Stop evidence; this does not exercise IAM admission. */
export async function _SaveRunTreeSqlStop(transaction: Prisma.TransactionClient, fixture: RunTreeSqlFixture, runId: string, rootRunId: string | null): Promise<void>
{
	if (rootRunId !== null)
		await transaction.agentRunTreeAccount.update({ where: { runId: rootRunId }, data: { revision: { increment: 1 } } });
	const commandId = randomUUID();
	const commandDigest = `sha256:${commandId.replaceAll("-", "").repeat(2)}`;
	const decisionDigest = `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`;
	await transaction.$executeRaw`INSERT INTO audit_decisions (id, decision_digest, silo_id, actor_kind, actor_id, resource_kind, resource_id, action, catalog_id, catalog_revision, catalog_digest, arguments_digest, policy_revision_hash, effective_authorization_digest, outcome, reason_code) VALUES (${randomUUID()}, ${decisionDigest}, ${fixture.siloId}, 'user', ${fixture.requesterId}, 'conversation', ${`${runId}-conversation`}, 'use', 'tree-test-catalog', 1, ${`sha256:${"c".repeat(64)}`}, ${commandDigest}, ${`sha256:${"d".repeat(64)}`}, ${`sha256:${"e".repeat(64)}`}, 'allow', 'requester_stop')`;
	await transaction.$executeRaw`UPDATE agent_runs SET state='cancelling', cancellation_command_id=${commandId}, cancellation_command_digest=${commandDigest}, cancellation_bootstrap_id=${randomUUID()}, cancellation_requested_by_principal_id=${fixture.requesterId}, cancellation_requested_at=clock_timestamp(), cancellation_authorization_decision_digest=${decisionDigest}, cancellation_workflow_task_id=${randomUUID()}, cancellation_workflow_task_name='conversation-computer-stop', cancellation_workflow_task_key=${commandId} WHERE id=${runId}`;
}

/** Builds the actual pending custody row written before provider issuance; no provider is called. */
export function _RunTreeSqlCredentialData(fixture: RunTreeSqlFixture, runId: string): Prisma.ConversationComputerAttemptCredentialUncheckedCreateInput
{
	return { bootstrapId: randomUUID(), runId, attempt: 1, siloId: fixture.siloId, conversationId: `${runId}-conversation`, keyAlias: `attempt-${runId}`, modelAlias: fixture.modelId, state: "pending", claimFence: randomUUID(), claimExpiresAt: fixture.deadlineAt, expiresAt: new Date(0) };
}

/** Writes production custody rather than a second, unused authorization table. */
export async function _SaveRunTreeSqlAttemptCredential(transaction: Prisma.TransactionClient, fixture: RunTreeSqlFixture, runId: string): Promise<void>
{
	await transaction.conversationComputerAttemptCredential.create({ data: _RunTreeSqlCredentialData(fixture, runId) });
}
