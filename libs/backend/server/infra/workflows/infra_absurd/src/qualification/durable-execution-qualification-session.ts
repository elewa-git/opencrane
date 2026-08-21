import { Absurd } from "absurd-sdk";
import { Pool } from "pg";

import type { DurableTaskReceipt, DurableWorkers } from "@opencrane/backend/server/infra/workflows/contract";

import { AbsurdDurableExecution } from "../absurd-durable-execution";
import type { DurableQualificationUnitOfWork } from "./durable-qualification-unit-of-work.types";
import type { _DurableExecutionQualificationInput, _DurableExecutionQualificationSession, _DurableExecutionQualificationSessionOptions } from "./durable-execution-qualification-session.types";
import { PrismaDurableQualificationUnitOfWork } from "./prisma-durable-qualification-unit-of-work";

const _TaskName = "opencrane.durable-execution.pickup-qualification";

interface _SessionResources
{
	readonly databasePool: Pool;
	readonly execution: AbsurdDurableExecution;
	readonly queueOwner: Absurd;
	readonly unitOfWork: DurableQualificationUnitOfWork;
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
 * Owns every live resource whose cleanup order must survive admission or observation failures.
 *
 * Called by: {@link _CreateDurableExecutionQualificationSession} in production and the lifecycle
 * contract tests with injected resources. The runner receives only the narrower session interface.
 */
export class _AbsurdDurableExecutionQualificationSession implements _DurableExecutionQualificationSession
{
	private readonly options: _DurableExecutionQualificationSessionOptions;
	private readonly resources: _SessionResources;
	private workers: DurableWorkers | undefined;
	private queueCreated = false;

	/**
	 * Accept prebuilt resources so lifecycle tests never need a live PostgreSQL process.
	 *
	 * @param options Unique queue, silo, and connection identities for this run.
	 * @param resources Engine, queue, transaction, and pool owners released by {@link close}.
	 */
	constructor(options: _DurableExecutionQualificationSessionOptions, resources: _SessionResources)
	{
		this.options = options;
		this.resources = resources;
	}

	/**
	 * Create the temporary queue, register its only task, and start one worker group.
	 *
	 * @throws When queue creation, task registration, or worker startup fails.
	 * @see _DurableExecutionQualificationSession.start
	 */
	async start(onStarted: (input: _DurableExecutionQualificationInput) => void): Promise<void>
	{
		await this.resources.queueOwner.createQueue(this.options.queueName);
		this.queueCreated = true;
		const siloId = this.options.siloId;
		this.resources.execution.register<_DurableExecutionQualificationInput, null>({
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
	 * Admit one task through the exact transaction that commits its durable receipt.
	 *
	 * @throws When the transaction, engine admission, or receipt validation fails.
	 * @see _DurableExecutionQualificationSession.admit
	 */
	async admit(input: _DurableExecutionQualificationInput): Promise<DurableTaskReceipt>
	{
		let receipt: DurableTaskReceipt | undefined;
		await this.resources.unitOfWork.admit(async transaction =>
		{
			receipt = await this.resources.execution.spawn(transaction, { taskName: _TaskName, idempotencyKey: `${this.options.runId}:${input.sampleIndex}`, input });
		});
		if (receipt === undefined) throw new Error("Qualification admission returned no receipt.");
		return receipt;
	}

	/**
	 * Observe only connections tagged by this application role and hide database diagnostics.
	 *
	 * @returns A safe count, or `null` when application-role observation is unavailable.
	 * @see _DurableExecutionQualificationSession.connectionCount
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
	 * Drain workers before dropping their queue and then release clients in ownership order.
	 *
	 * Every later cleanup still runs after an earlier failure; any failure rejects the whole gate.
	 * @throws When any worker, queue, client, or pool cannot be released.
	 * @see _DurableExecutionQualificationSession.close
	 */
	async close(): Promise<void>
	{
		const failures: unknown[] = [];
		if (this.workers !== undefined) await this.workers.drain().catch(function _Remember(error) { failures.push(error); });
		if (this.queueCreated) await this.resources.queueOwner.dropQueue(this.options.queueName).catch(function _Remember(error) { failures.push(error); });
		await this.resources.queueOwner.close().catch(function _Remember(error) { failures.push(error); });
		await this.resources.unitOfWork.close().catch(function _Remember(error) { failures.push(error); });
		await this.resources.databasePool.end().catch(function _Remember(error) { failures.push(error); });
		if (failures.length > 0) throw new Error("Durable execution qualification could not remove its queue or release its connections.");
	}
}

/**
 * Build the live Absurd, queue, Prisma, and shared-pool resources for one Gate D2 session.
 *
 * Called by: {@link __QualifyDurableExecutionPickup} through its production runtime.
 */
export function _CreateDurableExecutionQualificationSession(options: _DurableExecutionQualificationSessionOptions): _DurableExecutionQualificationSession
{
	const databaseUrl = _QualifiedDatabaseUrl(options.databaseUrl, options.applicationName);
	const prismaDatabaseUrl = new URL(databaseUrl);
	prismaDatabaseUrl.searchParams.set("connection_limit", "1");
	const databasePool = new Pool({ connectionString: databaseUrl, max: options.databasePoolSize });
	const queueAuthority = Object.freeze({ queueForTask(taskName: string): string { if (taskName !== _TaskName) throw new Error("Qualification task is not admitted."); return options.queueName; } });
	const execution = new AbsurdDurableExecution({ databaseUrl, databasePool, databasePoolSize: options.databasePoolSize, queueAuthority, workerConcurrency: 1, pollIntervalMs: options.pollIntervalMs });
	return new _AbsurdDurableExecutionQualificationSession(options, {
		databasePool,
		execution,
		queueOwner: new Absurd({ db: databasePool, queueName: options.queueName }),
		unitOfWork: new PrismaDurableQualificationUnitOfWork(prismaDatabaseUrl.toString()),
	});
}
