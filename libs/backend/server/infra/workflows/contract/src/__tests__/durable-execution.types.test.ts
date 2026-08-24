import { describe, expect, it } from "vitest";

import { DurableTaskCompensationError, DurableTaskFailureKinds, DurableTaskRetryableError, DurableTaskTerminalError } from "../durable-execution.types";

describe("durable task failure contract", function _DurableTaskFailureContractSuite()
{
	it("preserves each closed engine outcome on its typed error", function _PreservesFailureKinds()
	{
		expect(new DurableTaskRetryableError("transient").kind).toBe(DurableTaskFailureKinds.Retryable);
		expect(new DurableTaskTerminalError("terminal").kind).toBe(DurableTaskFailureKinds.Terminal);
		expect(new DurableTaskCompensationError("compensate").kind).toBe(DurableTaskFailureKinds.Compensate);
	});
});
