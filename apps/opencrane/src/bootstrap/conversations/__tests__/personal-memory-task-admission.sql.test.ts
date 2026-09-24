import { randomUUID } from "node:crypto";
import { Absurd } from "absurd-sdk";
import pg from "pg";
import { AuthorizationBoundaryKind, MemoryDatasetState, PrincipalProvenance, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PersonalMemoryOperationAdmissionOutcomes, PersonalMemoryOperationKinds, PrismaPersonalMemoryOperationRepository, type AdmitPersonalMemoryOperationCommand } from "@opencrane/backend/agents/personal/memory";
import { PERSONAL_MEMORY_OPERATION_TASK, _CreatePersonalMemoryOperationTask } from "@opencrane/backend/server/conversations";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";

/** Uses the disposable baseline database without connecting to a memory provider. */
const _Client = new PrismaClient();
/** Lets an independent SDK connection observe which task rows actually committed. */
const _Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
/** Keeps this proof's admitted tasks separate from all other integration fixtures. */
const _Queue = `memory-proof-${randomUUID()}`;
/** Reads real Absurd task receipts; no worker is started by this suite. */
let _QueueOwner: Absurd;

/** Creates a process-local engine facade with the production memory task declaration. */
function _Engine()
{
	const engine = _CreateAbsurdWorkflowEngine({ databaseUrl: process.env.DATABASE_URL!, databasePool: _Pool, databasePoolSize: 2, queueAuthority: { queueForTask: function _QueueForTask() { return _Queue; } } });
	engine.declare(PERSONAL_MEMORY_OPERATION_TASK);
	return engine;
}

/** Seeds synthetic domain coordinates; this fixture grants no product memory permission. */
async function _Fixture(): Promise<AdmitPersonalMemoryOperationCommand>
{
	const principalId = randomUUID();
	const datasetId = randomUUID();
	const operationId = randomUUID();
	await _Client.principal.create({ data: { id: principalId, siloId: principalId, issuer: "https://identity.example.test", subject: principalId, provenance: PrincipalProvenance.External } });
	await _Client.memoryDataset.create({ data: { id: datasetId, siloId: principalId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, createdBy: principalId, state: MemoryDatasetState.Provisioning, cogneeDatasetId: null } });
	return {
		operationId, siloId: principalId, datasetId, actorPrincipalId: principalId,
		idempotencyKeyDigest: `sha256:${operationId.replaceAll("-", "").repeat(2)}`,
		commandDigest: `sha256:${"b".repeat(64)}`, kind: PersonalMemoryOperationKinds.Remember,
		source: { conversationId: randomUUID(), messageId: randomUUID(), messagePosition: 1n, payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}`, authorPrincipalId: principalId },
		contentDigest: `sha256:${"a".repeat(64)}`, targetFactId: null, targetDocumentId: null, expectedFactRevision: null,
		providerDatasetId: null, task: { taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, taskKey: operationId }, admittedAt: new Date(),
	};
}

/** Couples the real task admission and operation insert through the same Serializable transaction. */
function _Admit(engine: ReturnType<typeof _Engine>, client: PrismaClient, command: AdmitPersonalMemoryOperationCommand, admittedTaskIds: string[])
{
	return ___RunInPrismaUnitOfWork(client, async function _InTransaction(transaction)
	{
		const repository = new PrismaPersonalMemoryOperationRepository(transaction);
		return repository.admit(command, async function _AdmitTask(coordinates)
		{
			const task = _CreatePersonalMemoryOperationTask({ siloId: command.siloId, operationId: command.operationId });
			expect(coordinates).toEqual({ taskName: task.taskName, taskKey: task.idempotencyKey });
			const receipt = await engine.spawn({ client: transaction }, task);
			admittedTaskIds.push(receipt.taskId);
			return { taskId: receipt.taskId, taskName: receipt.taskName, taskKey: receipt.idempotencyKey };
		});
	}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "personal-memory task admission SQL proof" });
}

describe("personal-memory operation and Absurd admission atomicity", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Memory task admission requires DATABASE_URL and the fresh target baseline");
		await _Client.$connect();
		_QueueOwner = new Absurd({ db: _Pool, queueName: _Queue });
		await _QueueOwner.createQueue(_Queue);
	});
	afterAll(async function _Close() { await _Client.$disconnect(); await _QueueOwner?.close(); await _Pool.end(); });

	it("concurrent command replay commits one operation and one actual Absurd task", async function _ConcurrentAdmission()
	{
		const first = _Engine();
		const second = _Engine();
		const otherClient = new PrismaClient();
		try
		{
			const command = await _Fixture();
			const admittedTaskIds: string[] = [];
			const results = await Promise.all([_Admit(first, _Client, command, admittedTaskIds), _Admit(second, otherClient, command, admittedTaskIds)]);
			expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Created)).toHaveLength(1);
			expect(results.filter(result => result.outcome === PersonalMemoryOperationAdmissionOutcomes.Replayed)).toHaveLength(1);
			expect(admittedTaskIds).toHaveLength(1);
			expect(results.map(result => result.operation.task.taskId)).toEqual([admittedTaskIds[0], admittedTaskIds[0]]);
			expect(admittedTaskIds[0]).not.toBe(command.operationId);
			expect(await _QueueOwner.fetchTaskResult(admittedTaskIds[0]!)).not.toBeNull();
			expect(await _Client.personalMemoryOperation.count({ where: { siloId: command.siloId } })).toBe(1);
		}
		finally { await first.close(); await second.close(); await otherClient.$disconnect(); }
	});

	it("a new engine and database client recover the saved task without calling admission again", async function _RestartReplay()
	{
		const command = await _Fixture();
		const first = _Engine();
		const admittedTaskIds: string[] = [];
		const original = await _Admit(first, _Client, command, admittedTaskIds);
		await first.close();
		const restarted = _Engine();
		const restartedClient = new PrismaClient();
		try
		{
			const recoveryTaskIds: string[] = [];
			const replay = await _Admit(restarted, restartedClient, command, recoveryTaskIds);
			expect(replay).toEqual({ outcome: PersonalMemoryOperationAdmissionOutcomes.Replayed, operation: original.operation });
			expect(recoveryTaskIds).toEqual([]);
			expect(await _QueueOwner.fetchTaskResult(replay.operation.task.taskId)).not.toBeNull();
			expect(await restartedClient.personalMemoryOperation.count({ where: { siloId: command.siloId } })).toBe(1);
		}
		finally { await restarted.close(); await restartedClient.$disconnect(); }
	});

	it.each(["mismatched receipt", "failure after operation insert"])("%s rolls back both the task and operation", async function _Rollback(failure)
	{
		const command = await _Fixture();
		const engine = _Engine();
		const admittedTaskIds: string[] = [];
		try
		{
			await expect(_Client.$transaction(async function _FailAdmission(transaction)
			{
				const repository = new PrismaPersonalMemoryOperationRepository(transaction);
				await repository.admit(command, async function _AdmitThenFail()
				{
					const task = _CreatePersonalMemoryOperationTask({ siloId: command.siloId, operationId: command.operationId });
					const receipt = await engine.spawn({ client: transaction }, task);
					admittedTaskIds.push(receipt.taskId);
					const taskKey = failure === "mismatched receipt" ? randomUUID() : receipt.idempotencyKey;
					return { taskId: receipt.taskId, taskName: receipt.taskName, taskKey };
				});
				throw new Error("Synthetic failure after operation insert");
			}, { isolationLevel: "Serializable" })).rejects.toThrow(failure === "mismatched receipt" ? "workflow receipt does not match" : "Synthetic failure after operation insert");
			expect(admittedTaskIds).toHaveLength(1);
			expect(await _QueueOwner.fetchTaskResult(admittedTaskIds[0]!)).toBeNull();
			expect(await _Client.personalMemoryOperation.findUnique({ where: { id: command.operationId } })).toBeNull();
			const retry = await _Admit(engine, _Client, command, []);
			expect(retry.outcome).toBe(PersonalMemoryOperationAdmissionOutcomes.Created);
			expect(await _QueueOwner.fetchTaskResult(retry.operation.task.taskId)).not.toBeNull();
		}
		finally { await engine.close(); }
	});
});
