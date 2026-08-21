import type { DurableExecutionContractHarnessFactory } from "../durable-execution-contract.types";
import { _DescribeDurableExecutionContract } from "../durable-execution-contract";
import { __FakeDurableExecution } from "../fake-durable-execution";

/** Exercise the reusable adapter contract against the deterministic engine-free fake. */
const _CreateFakeHarness: DurableExecutionContractHarnessFactory = async function _createHarness()
{
	return { execution: new __FakeDurableExecution(), transaction: { client: { testTransaction: true } } };
};

_DescribeDurableExecutionContract("fake durable execution", _CreateFakeHarness);
