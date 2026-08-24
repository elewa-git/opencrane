import { describe, expect, it } from "vitest";

import { DurableTaskFailureKinds, DurableTaskRetryableError, DurableTaskTerminalError } from "../durable-execution.types";

describe("durable task failure contract", function _DurableTaskFailureContractSuite()
{
	it("preserves retry and terminal outcomes on their typed errors", function _PreservesFailureKinds()
	{
		expect(new DurableTaskRetryableError("transient").kind).toBe(DurableTaskFailureKinds.Retryable);
		expect(new DurableTaskTerminalError("terminal").kind).toBe(DurableTaskFailureKinds.Terminal);
	});
});
