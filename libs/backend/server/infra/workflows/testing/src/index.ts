/** Exposes test support for engine-neutral workflow adapters. */
export { __TestWorkflowEngineContract } from "./__tests__/workflow-engine-contract";
export { __FakeWorkflowEngine } from "./fake-workflow-engine";
export type { IWorkflowHarness, IWorkflowHarnessFactory } from "./__tests__/workflow-engine-contract.types";
export type { FakeWorkflowTaskSnapshot } from "./fake-workflow-engine.types";
