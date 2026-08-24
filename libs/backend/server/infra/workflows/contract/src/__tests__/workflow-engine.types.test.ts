import { describe, expect, it } from "vitest";

import { WorkflowTaskCompensationError, WorkflowTaskFailureKinds, WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "../workflow-engine.types";

describe("workflow task failure contract", function _WorkflowTaskFailureContractSuite()
{
	it("preserves each closed engine outcome on its typed error", function _PreservesFailureKinds()
	{
		expect(new WorkflowTaskRetryableError("transient").kind).toBe(WorkflowTaskFailureKinds.Retryable);
		expect(new WorkflowTaskTerminalError("terminal").kind).toBe(WorkflowTaskFailureKinds.Terminal);
		expect(new WorkflowTaskCompensationError("compensate").kind).toBe(WorkflowTaskFailureKinds.Compensate);
	});
});
