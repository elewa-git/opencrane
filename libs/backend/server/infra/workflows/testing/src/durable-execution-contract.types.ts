import type { DurableExecution, DurableExecutionTransaction, DurableWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/** Fresh adapter wiring that the reusable durable execution contract suite exercises. */
export interface DurableExecutionContractHarness
{
	/** Engine-neutral task port and explicit server-owned worker runtime under test. */
	readonly execution: DurableExecution & DurableWorkerRuntime;
	/** Opaque caller-owned transaction context passed to every contract spawn. */
	readonly transaction: DurableExecutionTransaction;
	/** Release adapter resources after the contract case completes, when required. */
	readonly dispose?: () => Promise<void>;
}

/** Creates an isolated harness for one durable execution contract test. */
export interface DurableExecutionContractHarnessFactory
{
	/** Create a fresh execution port and its caller-owned transaction context. */
	(): Promise<DurableExecutionContractHarness>;
}
