import { randomUUID } from "node:crypto";

import { Absurd } from "absurd-sdk";
import { MemoryFactState, OrgMemberStatus, PrismaClient } from "@prisma/client";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PersonalMemoryOperationKinds, PrismaPersonalMemoryOperationRepository } from "@opencrane/backend/agents/personal/memory";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { ConversationCaller } from "../../../authorization/conversation-caller.types";
import { PERSONAL_MEMORY_OPERATION_TASK } from "../../workflow/personal-memory-operation-task";
import { PersonalMemoryCommandAdmissionOutcomes } from "../personal-memory-command-authority.types";
import type { PersonalMemoryCommand } from "../personal-memory-command.types";
import { PrismaPersonalMemoryCommandUnitOfWork } from "../prisma-personal-memory-command-unit-of-work";
import { _COMMAND_NOW, _GrantPersonalMemoryAction, _PersonalMemoryCommandSqlFixture, type PersonalMemoryCommandSqlFixture } from "./personal-memory-command-admission.sql-fixture";

/** Primary database client used to issue product commands. */
const _Database = new PrismaClient();
/** Independent database client used to observe committed state. */
const _Observer = new PrismaClient();
/** Shared PostgreSQL pool used by actual Absurd task admission. */
const _Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
/** Isolated Absurd queue for personal-memory command proofs. */
const _Queue = `memory-command-proof-${randomUUID()}`;
/** Independent SDK client that observes committed or rolled-back tasks. */
let _QueueOwner: Absurd;

/** Explains each authority-loss fixture without using repeated control-flow strings. */
enum _DenialKind
{
	/** The principal never receives the required Forget grant. */
	MissingGrant = "missing grant",
	/** The exact Forget grant ends before command admission. */
	RevokedGrant = "revoked grant",
	/** The current organisation membership ends before command admission. */
	SuspendedMembership = "suspended membership",
}

/** Creates a real Absurd engine with the production memory task declaration. */
function _Engine(): ReturnType<typeof _CreateAbsurdWorkflowEngine>
{
	const engine = _CreateAbsurdWorkflowEngine({ databaseUrl: process.env.DATABASE_URL!, databasePool: _Pool, databasePoolSize: 2, queueAuthority: { queueForTask: function _QueueForTask() { return _Queue; } } });
	engine.declare(PERSONAL_MEMORY_OPERATION_TASK);
	return engine;
}

/** Builds the public Forget command for one existing fact. */
function _Forget(commandId: string, fixture: PersonalMemoryCommandSqlFixture): PersonalMemoryCommand
{
	return { commandId, kind: PersonalMemoryOperationKinds.Forget, targetFactId: fixture.factId, expectedFactRevision: 1 };
}

/** Creates the real command UnitOfWork while proving Forget never asks for source text. */
function _Authority(prisma: PrismaClient, engine: Pick<IWorkflowEngine, "spawn">, operationId: string): PrismaPersonalMemoryCommandUnitOfWork
{
	const sources = { async read(): Promise<never> { throw new Error("Forget admission must not read a message source"); } };
	return new PrismaPersonalMemoryCommandUnitOfWork(prisma, sources, engine, function _Clock() { return _COMMAND_NOW; }, function _OperationId() { return operationId; });
}

/** Delegates every admission to the actual engine while retaining its committed receipt. */
function _ObservedEngine(engine: IWorkflowEngine, receipts: IWorkflowTaskReceipt[]): Pick<IWorkflowEngine, "spawn">
{
	return { async spawn(transaction, task)
	{
		const receipt = await engine.spawn(transaction, task);
		receipts.push(receipt);
		return receipt;
	} };
}

/** Counts command-specific audit decisions through committed SQL state. */
function _AuditCount(siloId: string): Promise<number>
{
	return _Observer.auditDecision.count({ where: { siloId, resourceKind: ProductAuthorizationResourceKinds.MemoryScope, action: ProductAuthorizationActions.Forget } });
}

describe("personal-memory command admission on PostgreSQL and Absurd", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Personal-memory command SQL proofs require DATABASE_URL and the unchanged target baseline");
		await Promise.all([_Database.$connect(), _Observer.$connect()]);
		_QueueOwner = new Absurd({ db: _Pool, queueName: _Queue });
		await _QueueOwner.createQueue(_Queue);
	});

	afterAll(async function _Disconnect()
	{
		await Promise.all([_Database.$disconnect(), _Observer.$disconnect()]);
		await _QueueOwner?.close();
		await _Pool.end();
	});

	it("commits one matching audit digest, Forget hide, operation and actual Absurd receipt", async function _AtomicCommit()
	{
		const fixture = await _PersonalMemoryCommandSqlFixture(_Database);
		const operationId = randomUUID();
		const command = _Forget(randomUUID(), fixture);
		const engine = _Engine();
		try
		{
			const result = await _Authority(_Database, engine, operationId).admit(fixture.caller, command);
			expect(result).toMatchObject({ outcome: PersonalMemoryCommandAdmissionOutcomes.Accepted, receipt: { operationId } });
			const operation = await _Observer.personalMemoryOperation.findUniqueOrThrow({ where: { id: operationId } });
			const audit = await _Observer.auditDecision.findMany({ where: { siloId: fixture.caller.siloId, resourceKind: ProductAuthorizationResourceKinds.MemoryScope, resourceId: fixture.datasetId, action: ProductAuthorizationActions.Forget } });
			expect(audit).toHaveLength(1);
			expect(audit[0]?.argumentsDigest).toBe(operation.commandDigest);
			expect(await _Observer.memoryFactCatalog.findUniqueOrThrow({ where: { id: fixture.factId } })).toMatchObject({ state: MemoryFactState.ForgetPending, revision: 2 });
			expect(await _QueueOwner.fetchTaskResult(operation.workflowTaskId)).not.toBeNull();
		}
		finally { await engine.close(); }
	});

	it("concurrent exact replay and a restarted client retain one operation, task and audit", async function _Replay()
	{
		const fixture = await _PersonalMemoryCommandSqlFixture(_Database);
		const commandId = randomUUID();
		const operationId = randomUUID();
		const command = _Forget(commandId, fixture);
		const firstEngine = _Engine();
		const secondEngine = _Engine();
		const receipts: IWorkflowTaskReceipt[] = [];
		try
		{
			const results = await Promise.all([
				_Authority(_Database, _ObservedEngine(firstEngine, receipts), operationId).admit(fixture.caller, command),
				_Authority(_Observer, _ObservedEngine(secondEngine, receipts), operationId).admit(fixture.caller, command),
			]);
			expect(results.filter(result => result?.outcome === PersonalMemoryCommandAdmissionOutcomes.Accepted)).toHaveLength(1);
			expect(results.filter(result => result?.outcome === PersonalMemoryCommandAdmissionOutcomes.Idempotent)).toHaveLength(1);
			expect(receipts).toHaveLength(1);
			const restartedClient = new PrismaClient();
			const restartedEngine = _Engine();
			try
			{
				await expect(_Authority(restartedClient, _ObservedEngine(restartedEngine, receipts), operationId).admit(fixture.caller, command)).resolves.toMatchObject({ outcome: PersonalMemoryCommandAdmissionOutcomes.Idempotent, receipt: { operationId } });
				expect(receipts).toHaveLength(1);
			}
			finally { await restartedClient.$disconnect(); await restartedEngine.close(); }
			expect(await _Observer.personalMemoryOperation.count({ where: { siloId: fixture.caller.siloId } })).toBe(1);
			expect(await _AuditCount(fixture.caller.siloId)).toBe(1);
			expect(await _QueueOwner.fetchTaskResult(receipts[0]!.taskId)).not.toBeNull();
		}
		finally { await firstEngine.close(); await secondEngine.close(); }
	});

	it("a failure after real spawn rolls back the audit, operation, task and Forget hide", async function _Rollback()
	{
		const fixture = await _PersonalMemoryCommandSqlFixture(_Database);
		const operationId = randomUUID();
		const engine = _Engine();
		const receipts: IWorkflowTaskReceipt[] = [];
		const admit = PrismaPersonalMemoryOperationRepository.prototype.admit;
		const failure = vi.spyOn(PrismaPersonalMemoryOperationRepository.prototype, "admit").mockImplementation(async function _FailAfterAdmission(this: PrismaPersonalMemoryOperationRepository, command, admitTask)
		{
			await admit.call(this, command, admitTask);
			throw new Error("synthetic failure after real task and operation admission");
		});
		try
		{
			await expect(_Authority(_Database, _ObservedEngine(engine, receipts), operationId).admit(fixture.caller, _Forget(randomUUID(), fixture))).rejects.toThrow("synthetic failure after real task and operation admission");
			expect(receipts).toHaveLength(1);
			expect(await _Observer.personalMemoryOperation.findUnique({ where: { id: operationId } })).toBeNull();
			expect(await _AuditCount(fixture.caller.siloId)).toBe(0);
			expect(await _Observer.memoryFactCatalog.findUniqueOrThrow({ where: { id: fixture.factId } })).toMatchObject({ state: MemoryFactState.Active, revision: 1 });
			expect(await _QueueOwner.fetchTaskResult(receipts[0]!.taskId)).toBeNull();
		}
		finally { failure.mockRestore(); await engine.close(); }
	});

	it.each([_DenialKind.MissingGrant, _DenialKind.RevokedGrant, _DenialKind.SuspendedMembership])("%s admits no operation, audit or task", async function _Denied(kind)
	{
		const actions = kind === _DenialKind.MissingGrant ? [] : [ProductAuthorizationActions.Forget];
		const fixture = await _PersonalMemoryCommandSqlFixture(_Database, actions);
		if (kind === _DenialKind.RevokedGrant)
			await _Database.authorizationGrant.update({ where: { id: fixture.grantIds.get(ProductAuthorizationActions.Forget)! }, data: { revokedAt: _COMMAND_NOW } });
		if (kind === _DenialKind.SuspendedMembership)
			await _Database.orgMembership.update({ where: { clusterTenant_subject: { clusterTenant: fixture.caller.siloId, subject: fixture.caller.subjectId } }, data: { status: OrgMemberStatus.Suspended } });
		const engine = _Engine();
		const receipts: IWorkflowTaskReceipt[] = [];
		try
		{
			await expect(_Authority(_Database, _ObservedEngine(engine, receipts), randomUUID()).admit(fixture.caller, _Forget(randomUUID(), fixture))).resolves.toBeNull();
			expect(receipts).toEqual([]);
			expect(await _Observer.personalMemoryOperation.count({ where: { siloId: fixture.caller.siloId } })).toBe(0);
			expect(await _AuditCount(fixture.caller.siloId)).toBe(0);
			expect(await _Observer.memoryFactCatalog.findUniqueOrThrow({ where: { id: fixture.factId } })).toMatchObject({ state: MemoryFactState.Active, revision: 1 });
		}
		finally { await engine.close(); }
	});

	it("the same command UUID under two principals creates separate operations", async function _PrincipalNamespace()
	{
		const siloId = `memory-command-shared-${randomUUID()}`;
		const first = await _PersonalMemoryCommandSqlFixture(_Database, [ProductAuthorizationActions.Forget], siloId);
		const second = await _PersonalMemoryCommandSqlFixture(_Database, [ProductAuthorizationActions.Forget], siloId);
		const commandId = randomUUID();
		const firstOperationId = randomUUID();
		const secondOperationId = randomUUID();
		const engine = _Engine();
		try
		{
			const results = await Promise.all([
				_Authority(_Database, engine, firstOperationId).admit(first.caller, _Forget(commandId, first)),
				_Authority(_Observer, engine, secondOperationId).admit(second.caller, _Forget(commandId, second)),
			]);
			expect(results.map(result => result?.receipt.operationId).sort()).toEqual([firstOperationId, secondOperationId].sort());
			expect(await _Observer.personalMemoryOperation.count({ where: { siloId } })).toBe(2);
			expect(await _AuditCount(siloId)).toBe(2);
		}
		finally { await engine.close(); }
	});

	it("status requires the current owner's exact Read grant", async function _StatusAuthorization()
	{
		const fixture = await _PersonalMemoryCommandSqlFixture(_Database, [ProductAuthorizationActions.Forget]);
		const commandId = randomUUID();
		const operationId = randomUUID();
		const engine = _Engine();
		try
		{
			const authority = _Authority(_Database, engine, operationId);
			await authority.admit(fixture.caller, _Forget(commandId, fixture));
			await expect(authority.read(fixture.caller, commandId)).resolves.toBeNull();
			await _GrantPersonalMemoryAction(_Database, { siloId: fixture.caller.siloId, principalId: fixture.caller.principalId, datasetId: fixture.datasetId }, ProductAuthorizationActions.Read);
			await expect(authority.read(fixture.caller, commandId)).resolves.toMatchObject({ commandId, operationId });
			const other = await _PersonalMemoryCommandSqlFixture(_Database, [ProductAuthorizationActions.Read], fixture.caller.siloId);
			const otherCaller: ConversationCaller = other.caller;
			await _GrantPersonalMemoryAction(_Database, { siloId: fixture.caller.siloId, principalId: otherCaller.principalId, datasetId: fixture.datasetId }, ProductAuthorizationActions.Read);
			await expect(authority.read(otherCaller, commandId)).resolves.toBeNull();
		}
		finally { await engine.close(); }
	});
});
