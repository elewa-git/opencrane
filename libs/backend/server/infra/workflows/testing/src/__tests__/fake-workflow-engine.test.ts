import type { IWorkflowHarnessFactory } from "./workflow-engine-contract.types";
import { __TestWorkflowEngineContract } from "./workflow-engine-contract";
import { __FakeWorkflowEngine } from "../fake-workflow-engine";

/** Exercise the reusable adapter contract against the deterministic engine-free fake. */
const _CreateFakeHarness: IWorkflowHarnessFactory = async function _CreateHarness()
{
	return { execution: new __FakeWorkflowEngine(), transaction: { client: { testTransaction: true } } };
};

__TestWorkflowEngineContract("fake workflow engine", _CreateFakeHarness);
