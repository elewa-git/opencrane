import { z } from "zod";

import { WorkflowTaskRetryBackoffKinds, type IWorkflowEngine, type IWorkflowTaskContext, type IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { __McpConnectionTaskKey } from "./mcp-connection-digests";
import type { McpConnectionActivationTaskInput, McpConnectionRevocationTaskInput, McpConnectionTaskBinding, McpConnectionWorkflowAdmission, McpConnectionWorkflowController } from "./mcp-connection.types";

/** Stable Absurd task names for activation and cleanup. */
export enum McpConnectionTaskNames
{
	/** Verifies custody and completes authenticated discovery. */
	Activate = "mcp-connection.activate/v1",
	/** Deletes the revoked generation's exact immutable Secret. */
	Revoke = "mcp-connection.revoke/v1",
}

const _TASK_INPUT = z.object({
	siloId: z.string().min(1).max(256),
	connectionId: z.string().min(1).max(256),
	generation: z.number().int().positive().safe(),
	commandDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

/** Return transaction-bound admission before the controller construction graph is complete. */
export function __CreateMcpConnectionWorkflowAdmission(execution: IWorkflowEngine): McpConnectionWorkflowAdmission
{
	return {
		async admitActivation(transaction: IWorkflowTransaction, input: McpConnectionActivationTaskInput): Promise<McpConnectionTaskBinding>
		{
			_AssertTaskInput(input);
			const taskKey = __McpConnectionTaskKey("activate", input);
			const receipt = await execution.spawn(transaction, { taskName: McpConnectionTaskNames.Activate, idempotencyKey: taskKey, input });
			return _Binding(receipt, taskKey);
		},
		async admitRevocation(transaction: IWorkflowTransaction, input: McpConnectionRevocationTaskInput): Promise<McpConnectionTaskBinding>
		{
			_AssertTaskInput(input);
			const taskKey = __McpConnectionTaskKey("revoke", input);
			const receipt = await execution.spawn(transaction, { taskName: McpConnectionTaskNames.Revoke, idempotencyKey: taskKey, input });
			return _Binding(receipt, taskKey);
		},
	};
}

/** Register durable connection handlers after bootstrap constructs their controller. */
export function __RegisterMcpConnectionWorkflow(execution: IWorkflowEngine, controller: McpConnectionWorkflowController): void
{
	execution.register({
		taskName: McpConnectionTaskNames.Activate,
		retryPolicy: { maximumAttempts: 5, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 10, multiplier: 2, maximumDelaySeconds: 120 } },
		async run(context: IWorkflowTaskContext, input: McpConnectionActivationTaskInput): Promise<void>
		{
			_AssertTaskInput(input);
			await controller.activate(context, input);
		},
	});
	execution.register({
		taskName: McpConnectionTaskNames.Revoke,
		retryPolicy: { maximumAttempts: 8, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 10, multiplier: 2, maximumDelaySeconds: 300 } },
		async run(context: IWorkflowTaskContext, input: McpConnectionRevocationTaskInput): Promise<void>
		{
			_AssertTaskInput(input);
			await controller.revoke(context, input);
		},
	});
}

function _AssertTaskInput(input: McpConnectionActivationTaskInput | McpConnectionRevocationTaskInput): void
{
	if (!_TASK_INPUT.safeParse(input).success)
		throw new Error("MCP connection task input is invalid.");
}

function _Binding(receipt: { readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }, taskKey: string): McpConnectionTaskBinding
{
	if (receipt.idempotencyKey !== taskKey)
		throw new Error("MCP connection workflow returned a conflicting task key.");
	return { taskId: receipt.taskId, taskName: receipt.taskName, taskKey };
}
