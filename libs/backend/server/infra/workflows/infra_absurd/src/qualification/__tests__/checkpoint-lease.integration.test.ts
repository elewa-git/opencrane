import { randomUUID } from "node:crypto";

import { Absurd, TaskContext } from "absurd-sdk";
import pg, { type Pool as PgPool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { WorkflowTaskCancelledError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { _AbsurdTaskContext } from "../../absurd-task-context";

const { Pool } = pg;
const _RunIntegration = process.env.OPENCRANE_ABSURD_SQL_QUALIFICATION === "1";
const _LOG = { log(): void {}, info(): void {}, warn(): void {}, error(): void {} };

/** Return the explicit live qualification URL instead of accidentally using a local default. */
function _DatabaseUrl(): string
{
	const value = process.env.DATABASE_URL;
	if (value === undefined || value.trim().length === 0)
		throw new Error("DATABASE_URL is required for the Absurd checkpoint lease qualification.");
	return value;
}

/** Keep the live queue and pool isolated from every other qualification session. */
async function _Close(resources: { readonly client: Absurd; readonly pool: PgPool; readonly queueName: string }): Promise<void>
{
	await resources.client.dropQueue(resources.queueName).catch(function _IgnoreCleanupFailure(): void {});
	await resources.client.close().catch(function _IgnoreClientCleanupFailure(): void {});
	await resources.pool.end();
}

describe.skipIf(!_RunIntegration)("Absurd checkpoint lease SQL qualification", function _CheckpointLeaseQualificationSuite()
{
	it("rejects the stale run before its effect while the reclaimed run succeeds", async function _ReclaimedRunWins()
	{
		const pool = new Pool({ connectionString: _DatabaseUrl(), max: 2 });
		const queueName = `opencrane_lease_${randomUUID().replaceAll("-", "")}`;
		const client = new Absurd({ db: pool, queueName });
		const resources = { client, pool, queueName };
		const taskName = "opencrane.checkpoint-lease-qualification";
		const idempotencyKey = `${queueName}:task`;
		const effect = vi.fn(async function _Effect(): Promise<{ readonly applied: true }> { return { applied: true }; });

		try
		{
			await client.createQueue(queueName);
			const spawned = await client.spawn(taskName, { value: "lease" }, { idempotencyKey, maxAttempts: 2, queue: queueName, retryStrategy: { kind: "none" } });
			const taskReceipt: IWorkflowTaskReceipt = { taskId: spawned.taskID, taskName, idempotencyKey };
			const claimedA = (await client.claimTasks({ batchSize: 1, claimTimeout: 1, workerId: "qualification-a" }))[0];
			if (claimedA === undefined)
				throw new Error("Qualification did not claim the first run.");
			const sdkContextA = await TaskContext.create({ log: _LOG, taskID: claimedA.task_id, con: pool, queueName, task: claimedA, claimTimeout: 1, onLeaseExtended(): void {} });
			const contextA = new _AbsurdTaskContext(sdkContextA, taskReceipt, claimedA.attempt, {} as never, 10);

			await new Promise<void>(function _WaitForShortClaim(resolve) { setTimeout(resolve, 1_100); });
			let claimedB = (await client.claimTasks({ batchSize: 1, claimTimeout: 1, workerId: "qualification-b" }))[0];
			for (let poll = 0; claimedB === undefined && poll < 10; poll += 1)
			{
				await new Promise<void>(function _WaitForReclaim(resolve) { setTimeout(resolve, 100); });
				claimedB = (await client.claimTasks({ batchSize: 1, claimTimeout: 1, workerId: "qualification-b" }))[0];
			}
			if (claimedB === undefined)
				throw new Error("Qualification did not reclaim the expired run.");

			await expect(contextA.checkpoint({ stepName: "lease-sentinel" }, effect)).rejects.toBeInstanceOf(WorkflowTaskCancelledError);
			expect(effect).not.toHaveBeenCalled();

			client.registerTask({ name: taskName, queue: queueName }, async function _RunReclaimed(_params, context): Promise<null>
			{
				const adapted = new _AbsurdTaskContext(context, taskReceipt, claimedB.attempt, {} as never, 10);
				await adapted.checkpoint({ stepName: "lease-sentinel" }, effect);
				return null;
			});
			await client.executeTask(claimedB, 1, { fatalOnLeaseTimeout: false });

			expect(effect).toHaveBeenCalledOnce();
			const checkpoint = await pool.query("SELECT state, owner_run_id FROM absurd.get_task_checkpoint_state($1, $2, $3)", [queueName, taskReceipt.taskId, "lease-sentinel"]);
			expect(checkpoint.rows).toHaveLength(1);
			expect(checkpoint.rows[0].owner_run_id).toBe(claimedB.run_id);
		}
		finally
		{
			await _Close(resources);
		}
	}, 10_000);
});
