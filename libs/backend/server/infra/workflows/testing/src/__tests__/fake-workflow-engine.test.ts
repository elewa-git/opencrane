import { WorkflowTaskNotRegisteredError, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowHarnessFactory } from "./workflow-engine-contract.types";
import { expect, it } from "vitest";

import { __TestWorkflowEngineContract } from "./workflow-engine-contract";
import { __FakeWorkflowEngine } from "../fake-workflow-engine";

/** Exercise the reusable adapter contract against the deterministic engine-free fake. */
const _CreateFakeHarness: IWorkflowHarnessFactory = async function _CreateHarness()
{
	return { execution: new __FakeWorkflowEngine(), transaction: { client: { testTransaction: true } } };
};

__TestWorkflowEngineContract("fake workflow engine", _CreateFakeHarness);

it("rejects a remote-only task when a local handler tries to spawn it as a child", async function _RejectRemoteChild()
{
	const execution = new __FakeWorkflowEngine();
	execution.declare({ taskName: "remote-child" });
	execution.register({
		taskName: "local-parent",
		async run(context): Promise<void>
		{
			await context.spawnChild({ taskName: "remote-child", idempotencyKey: "remote-child-1", input: undefined });
		},
	});
	const parent = await execution.spawn({ client: undefined }, { taskName: "local-parent", idempotencyKey: "local-parent-1", input: undefined });

	await execution.startWorkers({ workerName: "fake-worker" });

	const snapshot = execution.taskSnapshot(parent);
	expect(snapshot.state).toBe(WorkflowTaskStates.Failed);
	expect(snapshot.error).toBeInstanceOf(WorkflowTaskNotRegisteredError);
});
