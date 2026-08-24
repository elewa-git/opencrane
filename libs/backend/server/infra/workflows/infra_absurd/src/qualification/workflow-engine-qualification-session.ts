import { Absurd } from "absurd-sdk";
import { Pool } from "pg";

import type { IWorkflowTaskReceipt, IWorkflowWorkers } from "@opencrane/backend/server/infra/workflows/contract";

import { AbsurdWorkflowEngine } from "../absurd-workflow-engine";
import type { IWorkflowEngineQualificationUnitOfWork } from "./workflow-engine-qualification-unit-of-work.types";
import type { IWorkflowEngineQualificationSession, IWorkflowEngineQualificationSessionOptions, IWorkflowTaskQualificationInput } from "./workflow-engine-qualification-session.types";
import { PrismaWorkflowEngineQualificationUnitOfWork } from "./prisma-workflow-engine-qualification-unit-of-work";

const _TaskName = "opencrane.workflow-engine.pickup-qualification";

interface IWorkflowEngineQualificationResources
{
	/** Provides the SDK pool and application-role connection observations. */
	readonly databasePool: Pool;
	/** Admits and dispatches the temporary qualification task. */
	readonly execution: AbsurdWorkflowEngine;
	/** Creates and drops the temporary queue. */
	readonly queueOwner: Absurd;
	/** Commits the receipt transaction for every measured task. */
	readonly unitOfWork: IWorkflowEngineQualificationUnitOfWork;
}

/** Add one non-secret connection identity without changing the credential or endpoint. */
function _QualifiedDatabaseUrl(databaseUrl: string, applicationName: string): string
{
	const url = new URL(databaseUrl);
	if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("databaseUrl must use PostgreSQL.");
	url.searchParams.set("application_name", applicationName);
	return url.toString();
}

/**
 * Implements the qualification session with live Absurd, Prisma, and PostgreSQL resources.
 *
 * One session owns the queue, workers, UnitOfWork, and pool it creates. Its close sequence keeps
 * releasing later resources after an earlier cleanup failure, which prevents a failed qualification
 * from leaving its temporary queue or connections behind.
 *
 * Called by: {@link _CreateWorkflowEngineQualificationSession} and the lifecycle contract test.
 * @implements IWorkflowEngineQualificationSession
 */
export class _AbsurdWorkflowEngineQualificationSession implements IWorkflowEngineQualificationSession
{
	/** Stores the identities and limits selected for this live run. */
	private readonly options: IWorkflowEngineQualificationSessionOptions;
	/** Stores resources that {@link close} releases in ownership order. */
	private readonly resources: IWorkflowEngineQualificationResources;
	/** Retains the worker lifecycle after {@link start} succeeds. */
	private workers: IWorkflowWorkers | undefined;
	/** Records whether partial startup created a queue that cleanup must drop. */
	private queueCreated = false;

	/**
	 * Accept prebuilt resources so lifecycle tests never need a live PostgreSQL process.
	 *
	 * @param options Unique queue, silo, and connection identities for this run.
	 * @param resources Engine, queue, transaction, and pool owners released by {@link close}.
	 */
	constructor(options: IWorkflowEngineQualificationSessionOptions, resources: IWorkflowEngineQualificationResources)
	{
		this.options = options;
		this.resources = resources;
	}

	/**
	 * Creates the temporary queue, registers its task, and starts one worker group.
	 *
	 * @throws When queue creation, task registration, or worker startup fails.
	 * @see IWorkflowEngineQualificationSession.start
	 */
	async start(onStarted: (input: IWorkflowTaskQualificationInput) => void): Promise<void>
	{
		await this.resources.queueOwner.createQueue(this.options.queueName);
		this.queueCreated = true;
		const siloId = this.options.siloId;
		this.resources.execution.register<IWorkflowTaskQualificationInput, null>({
			taskName: _TaskName,
			async run(_context, input): Promise<null>
			{
				if (input.siloId !== siloId) throw new Error("Qualification task has no local sample owner.");
				onStarted(input);
				return null;
			},
		});
		this.workers = await this.resources.execution.startWorkers({ workerName: `d2-${this.options.runId}` });
	}

	/**
	 * Submits the next task through the UnitOfWork transaction that commits its receipt.
	 *
	 * @throws When the transaction, engine admission, or receipt validation fails.
	 * @see IWorkflowEngineQualificationSession.next
	 */
	async next(input: IWorkflowTaskQualificationInput): Promise<IWorkflowTaskReceipt>
	{
		let receipt: IWorkflowTaskReceipt | undefined;
		const execution = this.resources.execution;
		const runId = this.options.runId;
		await this.resources.unitOfWork.admit(async function _Admit(transaction)
		{
			const task = { taskName: _TaskName, idempotencyKey: `${runId}:${input.sampleIndex}`, input };
			receipt = await execution.spawn(transaction, task);
		});
		if (receipt === undefined) throw new Error("Qualification admission returned no receipt.");
		return receipt;
	}

	/**
	 * Counts connections tagged by this application role without exposing database diagnostics.
	 *
	 * @returns A safe count, or `null` when application-role observation is unavailable.
	 * @see IWorkflowEngineQualificationSession.connectionCount
	 */
	async connectionCount(): Promise<number | null>
	{
		try
		{
			const result = await this.resources.databasePool.query<{ connection_count: string }>(
				"SELECT count(*)::text AS connection_count FROM pg_stat_activity WHERE application_name = $1 AND usename = current_user",
				[this.options.applicationName],
			);
			const count = Number(result.rows[0]?.connection_count);
			return Number.isSafeInteger(count) && count >= 0 ? count : null;
		}
		catch
		{
			return null;
		}
	}

	/**
	 * Drains workers before dropping their queue, then releases clients in ownership order.
	 *
	 * Every later cleanup still runs after an earlier failure; any failure rejects the whole gate.
	 * @throws When any worker, queue, client, or pool cannot be released.
	 * @see IWorkflowEngineQualificationSession.close
	 */
	async close(): Promise<void>
	{
		const failures: unknown[] = [];
		if (this.workers !== undefined) await this.workers.drain().catch(function _Remember(error) { failures.push(error); });
		if (this.queueCreated) await this.resources.queueOwner.dropQueue(this.options.queueName).catch(function _Remember(error) { failures.push(error); });
		await this.resources.queueOwner.close().catch(function _Remember(error) { failures.push(error); });
		await this.resources.unitOfWork.close().catch(function _Remember(error) { failures.push(error); });
		await this.resources.databasePool.end().catch(function _Remember(error) { failures.push(error); });
		if (failures.length > 0) throw new Error("Workflow engine qualification could not remove its queue or release its connections.");
	}
}

/**
 * Builds the live Absurd, queue, Prisma, and shared-pool resources for one Gate D2 session.
 *
 * Called by: {@link __QualifyWorkflowEnginePickup} through its production runtime.
 */
export function _CreateWorkflowEngineQualificationSession(options: IWorkflowEngineQualificationSessionOptions): IWorkflowEngineQualificationSession
{
	const databaseUrl = _QualifiedDatabaseUrl(options.databaseUrl, options.applicationName);
	const prismaDatabaseUrl = new URL(databaseUrl);
	prismaDatabaseUrl.searchParams.set("connection_limit", "1");
	const databasePool = new Pool({ connectionString: databaseUrl, max: options.databasePoolSize });
	const queueAuthority = Object.freeze({ queueForTask(taskName: string): string { if (taskName !== _TaskName) throw new Error("Qualification task is not admitted."); return options.queueName; } });
	const execution = new AbsurdWorkflowEngine({ databaseUrl, databasePool, databasePoolSize: options.databasePoolSize, queueAuthority, workerConcurrency: 1, pollIntervalMs: options.pollIntervalMs });
	return new _AbsurdWorkflowEngineQualificationSession(options, {
		databasePool,
		execution,
		queueOwner: new Absurd({ db: databasePool, queueName: options.queueName }),
		unitOfWork: new PrismaWorkflowEngineQualificationUnitOfWork(prismaDatabaseUrl.toString()),
	});
}
