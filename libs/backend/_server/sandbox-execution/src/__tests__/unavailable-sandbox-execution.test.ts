import { describe, expect, it } from "vitest";

import { __UnavailableSandboxJobExecutor, SandboxExecutionUnavailableError } from "../unavailable-sandbox-execution.js";

describe("unavailable sandbox job executor", function _suite()
{
	it("fails closed without inventing a job result", async function _runJob()
	{
		const executor = new __UnavailableSandboxJobExecutor();
		await expect(executor.runJob({ siloId: "silo-1", runId: "run-1", attempt: 1, toolRevisionId: "revision-1", toolInvocationId: "invocation-1", argumentsDigest: "sha256-digest", arguments: { query: "never-persisted" } })).rejects.toBeInstanceOf(SandboxExecutionUnavailableError);
	});
});
