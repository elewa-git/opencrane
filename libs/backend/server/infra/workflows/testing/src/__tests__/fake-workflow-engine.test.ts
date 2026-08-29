import { WorkflowError, WorkflowTaskRetryBackoffKinds, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
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

it("admits a declared remote child without trying to run its handler locally", async function _AdmitRemoteChild()
{
	const execution = new __FakeWorkflowEngine();
	let remoteChild: IWorkflowTaskReceipt | undefined;
	execution.declare({ taskName: "remote-child" });
	execution.register({
		taskName: "local-parent",
		async run(context): Promise<void>
		{
			remoteChild = await context.spawnChild({ taskName: "remote-child", idempotencyKey: "remote-child-1", input: undefined });
		},
	});
	const parent = await execution.spawn({ client: undefined }, { taskName: "local-parent", idempotencyKey: "local-parent-1", input: undefined });

	await execution.startWorkers({ workerName: "fake-worker" });

	const snapshot = execution.taskSnapshot(parent);
	expect(snapshot.state).toBe(WorkflowTaskStates.Completed);
	expect(remoteChild).toBeDefined();
	expect(execution.taskSnapshot(remoteChild!).state).toBe(WorkflowTaskStates.Pending);
});

it("uses the shared declaration validator", function _RejectInvalidDeclarations()
{
	const execution = new __FakeWorkflowEngine();
	expect(function _DeclareBlank() { execution.declare({ taskName: " " }); }).toThrow(WorkflowError);
	expect(function _DeclareNoAttempts() { execution.declare({ taskName: "remote", retryPolicy: { maximumAttempts: 0, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 0 } } }); }).toThrow(WorkflowError);
});
