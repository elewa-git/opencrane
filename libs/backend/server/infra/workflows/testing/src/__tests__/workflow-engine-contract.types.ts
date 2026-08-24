import type { IWorkflowEngine, IWorkflowTransaction, IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Supplies fresh workflow-engine wiring for each reusable contract test.
 *
 * Called by: {@link __TestWorkflowEngineContract}. A factory returns a new harness per case so a
 * task, event, or worker from one case cannot change the outcome of the next case.
 */
export interface IWorkflowHarness
{
	/** Provides the task port and server-owned worker runtime under test. */
	readonly execution: IWorkflowEngine & IWorkflowWorkerRuntime;
	/** Provides the caller-owned transaction passed to every task admission. */
	readonly transaction: IWorkflowTransaction;
	/** Releases adapter resources after a test case when that adapter owns resources. */
	readonly dispose?: () => Promise<void>;
}

/** Creates a fresh workflow harness for each test case in the shared contract suite. */
export interface IWorkflowHarnessFactory
{
	/** Creates an isolated engine and transaction context for one contract case. */
	(): Promise<IWorkflowHarness>;
}
