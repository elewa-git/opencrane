import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AGENT_RUNTIME_CONTINUATION_MAX_BYTES, AGENT_RUNTIME_CONTINUATION_VERSION, type RuntimeAttemptContinuation } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { RUNTIME_CONTINUATION_MAX_IDENTIFIER_CHARACTERS, RUNTIME_CONTINUATION_MAX_PENDING_CORRELATIONS, __DigestRuntimeContinuation, __ParseRuntimeContinuation } from "../runtime-continuation";

/** Build one digest-bound continuation with a durable tool correlation. */
function _Continuation(): RuntimeAttemptContinuation
{
	const covered = { version: AGENT_RUNTIME_CONTINUATION_VERSION, revision: 1, runId: "run-1", attempt: 1, inputGeneration: 0, appliedCommandSequence: 1, compiledInput: { runId: "run-1" }, modelMessages: [{ role: "assistant" }], pendingToolCalls: [{ toolInvocationId: "tool-1", frameworkCallId: "tool-1" }], pendingElicitations: [] } as unknown as Omit<RuntimeAttemptContinuation, "digest">;
	return { ...covered, digest: __DigestRuntimeContinuation(covered) };
}

describe("runtime continuation admission", function _Suite()
{
	it("matches the cross-language continuation fixtures", function _SharedFixtures()
	{
		const fixturePath = join(process.cwd(), "../../../../../docs/design/runtime-continuation-conformance-fixtures.json");
		const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as { readonly limits: { readonly identifierCharacters: number; readonly pendingCorrelationsPerClass: number; readonly serializedContinuationBytes: number }; readonly cases: readonly { readonly accepted: boolean; readonly document: unknown }[] };
		expect(fixtures.limits).toEqual({ identifierCharacters: RUNTIME_CONTINUATION_MAX_IDENTIFIER_CHARACTERS, pendingCorrelationsPerClass: RUNTIME_CONTINUATION_MAX_PENDING_CORRELATIONS, serializedContinuationBytes: AGENT_RUNTIME_CONTINUATION_MAX_BYTES });
		for (const fixture of fixtures.cases)
			expect(__ParseRuntimeContinuation(fixture.document) !== null).toBe(fixture.accepted);
	});

	it("accepts only the digest-bound protocol-v2 coordinates", function _ExactCoordinates()
	{
		const continuation = _Continuation();
		expect(__ParseRuntimeContinuation(continuation)?.continuation).toEqual(continuation);
	});

	it("rejects changed content and duplicate pending correlations", function _RejectChangedState()
	{
		const continuation = _Continuation();
		expect(__ParseRuntimeContinuation({ ...continuation, modelMessages: [{ role: "user" }] })).toBeNull();
		expect(__ParseRuntimeContinuation({ ...continuation, pendingToolCalls: [...continuation.pendingToolCalls, ...continuation.pendingToolCalls] })).toBeNull();
	});
});
