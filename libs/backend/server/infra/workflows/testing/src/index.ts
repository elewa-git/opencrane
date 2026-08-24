/** Exposes test support for engine-neutral workflow adapters. */
export { __TestWorkflowEngineContract } from "./__tests__/workflow-engine-contract";
export { __FakeDurableExecution } from "./fake-durable-execution";
export type { IWorkflowHarness, IWorkflowHarnessFactory } from "./__tests__/workflow-engine-contract.types";
export type { FakeDurableTaskSnapshot } from "./fake-durable-execution.types";
