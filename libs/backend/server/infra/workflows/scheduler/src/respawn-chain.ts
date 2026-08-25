import { createHash } from "node:crypto";

import { WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { EnsureRespawnChainHeadCommand, RespawnChainSpawn, SpawnRespawnChainSuccessorCommand } from "./respawn-chain.types";

/** Reject an empty identity before it can collapse unrelated recurring work onto one key. */
function _RequireStableKey(name: string, value: string): void
{
	if (value.trim().length === 0)
	{
		throw new Error(`${name} must be a non-empty string.`);
	}
}

/**
 * Derive the idempotency key for one recurring chain slot without leaking domain input.
 *
 * Called by: {@link __EnsureRespawnChainHead} and {@link __SpawnRespawnChainSuccessor}.
 */
export function __RespawnChainTaskKey(chainKey: string, slotKey: string): string
{
	_RequireStableKey("chainKey", chainKey);
	_RequireStableKey("slotKey", slotKey);
	const encoded = JSON.stringify([chainKey, slotKey]);
	return `workflows:respawn:${createHash("sha256").update(encoded).digest("hex")}`;
}

/**
 * Idempotently start or repair a recurrence at a scheduler-owned head slot.
 *
 * The scheduler calculates `slotKey` from its own cron and timezone rules. This helper only turns
 * that identity into a workflow task admission, so it cannot silently replace product schedule
 * semantics or add a second cron interpreter.
 *
 * Called by: product scheduling composition when it starts or repairs a recurrence.
 * @see {@link __SpawnRespawnChainSuccessor} for the completion-driven next task.
 */
export async function __EnsureRespawnChainHead(execution: IWorkflowEngine, command: EnsureRespawnChainHeadCommand): Promise<RespawnChainSpawn>
{
	_RequireStableKey("taskName", command.taskName);
	const taskKey = __RespawnChainTaskKey(command.chainKey, command.slotKey);
	const receipt = await execution.spawn(command.transaction, { taskName: command.taskName, idempotencyKey: taskKey, input: command.input });
	return { taskKey, receipt };
}

/**
 * Spawn one fresh successor after a completed task, never by extending a sleeping task.
 *
 * A successor must occupy a different scheduler slot from the completed task. The different
 * deterministic key gives the engine a new task and keeps each task's checkpoint history bounded.
 *
 * Called by: product scheduling composition after the workflow engine has recorded completion.
 * @see {@link __EnsureRespawnChainHead} for initial and repaired chain admission.
 */
export async function __SpawnRespawnChainSuccessor(execution: IWorkflowEngine, command: SpawnRespawnChainSuccessorCommand): Promise<RespawnChainSpawn>
{
	_RequireStableKey("taskName", command.taskName);
	_RequireStableKey("completed.taskId", command.completed.taskId);
	_RequireStableKey("completed.slotKey", command.completed.slotKey);
	if (command.completed.state !== WorkflowTaskStates.Completed)
	{
		throw new Error("Only a completed task may spawn a respawn-chain successor.");
	}
	if (command.completed.slotKey === command.nextSlotKey)
	{
		throw new Error("A respawn-chain successor must use a fresh slot key.");
	}
	const taskKey = __RespawnChainTaskKey(command.chainKey, command.nextSlotKey);
	const receipt = await execution.spawn(command.transaction, { taskName: command.taskName, idempotencyKey: taskKey, input: command.input });
	return { taskKey, receipt };
}
