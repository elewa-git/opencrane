import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationModelResponseKinds, ConversationModelToolModes, type ConversationModelRequest, type ConversationModelToolCall, type CompiledToolDefinition } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __RequestConversationModel } from "../core/conversation-model";
import { ConversationModelError, ConversationModelFailureCodes } from "../core/conversation-model.types";

const _telemetry = vi.hoisted(function _captureTelemetry()
{
	return { fields: [] as unknown[], errors: [] as unknown[], suppressed: 0 };
});

vi.mock("@opencrane/backend/observability", function _observabilityContract()
{
	return {
		async ___DoWithTrace(_name: string, fields: unknown, work: () => Promise<unknown>)
		{
			_telemetry.fields.push(fields);
			try { return await work(); }
			catch (error) { _telemetry.errors.push(error); throw error; }
		},
		___DoWithoutTrace(work: () => unknown)
			{ _telemetry.suppressed++; return work(); },
	};
});

const _NOW = Date.parse("2026-09-09T02:00:00.000Z");

/** Supplies frozen inputs whose different ceilings expose accidental widening. */
function _request(overrides: Partial<ConversationModelRequest> = {}): ConversationModelRequest
{
	return {
		compiledInput: {
			promptCompilerVersion: "test-compiler", runId: "run-1", attempt: 1, instructions: "Private instructions.",
			messages: [{ role: "user", content: "Private question." }, { role: "assistant", content: "Earlier answer." }],
			tools: [], model: { modelAlias: "admitted-model", maxOutputTokens: 400, generatedOutputCapabilities: [] },
			budget: { maxModelTurns: 1, maxCompletionTokens: 300, maxCostUsdMicros: 1000, maxToolInvocations: 0, wallClockDeadlineEpochMs: _NOW + 60_000 },
			digest: "sha256:test",
		},
		endpoint: "http://litellm.release.svc.cluster.local", key: "sk-private-attempt", modelAlias: "admitted-model",
		maxCompletionTokens: 200, notAfterEpochMs: _NOW + 25_000, tools: ConversationModelToolModes.None, continuation: null, ...overrides,
	};
}

/** Builds the upstream text envelope, including nullable optional fields emitted by compatible proxies. */
function _answer(text = "  Saved answer.\n"): unknown
{
	return { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text, tool_calls: null, refusal: null } }], usage: { completion_tokens: 10 } };
}

/** Gives the fetch double a real streaming Response without opening a socket. */
function _response(body: unknown = _answer()): Response
{
	return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
}

beforeEach(function _setup()
{
	vi.useFakeTimers();
	vi.setSystemTime(_NOW);
	_telemetry.fields.length = 0;
	_telemetry.errors.length = 0;
	_telemetry.suppressed = 0;
});

afterEach(function _restore()
{
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("one conversation model text exchange", function _transportSuite()
{
	it("sends the frozen ordered text and minimum ceiling in exactly one credential-free JSON body", async function _requestBinding()
	{
		const fetchMock = vi.fn().mockResolvedValue(_response());
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).resolves.toEqual({ kind: ConversationModelResponseKinds.Text, text: "  Saved answer.\n" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		expect(url.toString()).toBe("http://litellm.release.svc.cluster.local/v1/chat/completions");
		expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer sk-private-attempt" } });
		expect(JSON.parse(String(init.body))).toEqual({ model: "admitted-model", max_tokens: 200, n: 1, stream: false, messages: [
			{ role: "system", content: "Private instructions." }, { role: "user", content: "Private question." }, { role: "assistant", content: "Earlier answer." },
		] });
		expect(String(init.body)).not.toContain("sk-private-attempt");
		expect(_telemetry.fields).toEqual([{}]);
		expect(_telemetry.suppressed).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([[300, 200, 1000, 200], [100, 200, 1000, 100], [null, 200, 1000, 200], [300, null, 1000, 300]])(
		"caps route %s, budget %s and reservation %s at %s", async function _completionCeilings(route, budget, reserved, expected)
		{
			const fetchMock = vi.fn().mockResolvedValue(_response());
			vi.stubGlobal("fetch", fetchMock);
			const input = _request();
			await __RequestConversationModel({ ...input, maxCompletionTokens: reserved!, compiledInput: { ...input.compiledInput,
				model: { ...input.compiledInput.model, maxOutputTokens: route! }, budget: { ...input.compiledInput.budget, maxCompletionTokens: budget! },
			} });
			expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body)).max_tokens).toBe(expected);
		});

	it.each(["https://user:secret@proxy.example", "https://proxy.example/base", "https://proxy.example/?key=secret", "https://proxy.example/#route", "file:///tmp/model"])(
		"rejects unsafe configured endpoint %s before dispatch", async function _endpoint(endpoint)
		{
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			await expect(__RequestConversationModel(_request({ endpoint }))).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
			expect(fetchMock).not.toHaveBeenCalled();
		});

	it.each([
		{ modelAlias: "different-model" }, { maxCompletionTokens: 0 }, { maxCompletionTokens: Infinity },
		{ maxCompletionTokens: 1.5 }, { notAfterEpochMs: NaN }, { key: "secret\r\nx-injected: yes" },
	])("rejects unusable server request %j", async function _requestBounds(overrides)
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request(overrides))).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(["no-ceiling", "zero-ceiling", "no-turns", "tool-message", "bad-unicode"])("rejects frozen input %s without a request", async function _frozenValidation(kind)
	{
		const input = _request();
		const compiledInput = structuredClone(input.compiledInput);
		const replacement = {
			...compiledInput,
			instructions: kind === "bad-unicode" ? "\ud800" : compiledInput.instructions,
			messages: kind === "tool-message" ? [{ role: "tool" as const, content: "pending tool result" }] : compiledInput.messages,
			model: { ...compiledInput.model, maxOutputTokens: kind === "no-ceiling" ? null : compiledInput.model.maxOutputTokens },
			budget: { ...compiledInput.budget, maxCompletionTokens: kind === "no-ceiling" ? null : compiledInput.budget.maxCompletionTokens,
				maxModelTurns: kind === "no-turns" ? 0 : 1 },
		};
		if (kind === "zero-ceiling")
			replacement.model.maxOutputTokens = 0;
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel({ ...input, compiledInput: replacement })).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(["x".repeat(1024 * 1024), "\u0000".repeat(200_000)])("rejects oversized serialized instructions before sending", async function _requestSize(instructions)
	{
		const input = _request();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel({ ...input, compiledInput: { ...input.compiledInput, instructions } })).rejects.toMatchObject({ code: ConversationModelFailureCodes.RequestTooLarge });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects an expired deadline without dispatch", async function _alreadyExpired()
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request({ notAfterEpochMs: _NOW }))).rejects.toMatchObject({ code: ConversationModelFailureCodes.DeadlineExceeded });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(["reserved", "compiled", "transport-cap"])("aborts once at the %s deadline with no retry", async function _deadline(bound)
	{
		let seenSignal: AbortSignal | undefined;
		const fetchMock = vi.fn(function _waitForAbort(_url: URL, init: RequestInit)
		{
			seenSignal = init.signal as AbortSignal;
			return new Promise<Response>(function _pending(_resolve, reject)
			{
				seenSignal!.addEventListener("abort", function _aborted() { reject(new Error("remote error with sk-private-attempt")); }, { once: true });
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		const input = _request({ notAfterEpochMs: _NOW + 100_000 });
		const request = { ...input, notAfterEpochMs: bound === "reserved" ? _NOW + 10 : input.notAfterEpochMs,
			compiledInput: { ...input.compiledInput, budget: { ...input.compiledInput.budget, wallClockDeadlineEpochMs: bound === "compiled" ? _NOW + 10 : _NOW + 100_000 } } };
		const outcome = expect(__RequestConversationModel(request)).rejects.toMatchObject({ code: ConversationModelFailureCodes.DeadlineExceeded });
		await vi.advanceTimersByTimeAsync(bound === "transport-cap" ? 25_000 : 10);
		await outcome;
		expect(seenSignal?.aborted).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cancels a response body stalled after successful headers at the same deadline", async function _slowBody()
	{
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"choices\":")); }, cancel });
		const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetchMock);
		const outcome = expect(__RequestConversationModel(_request({ notAfterEpochMs: _NOW + 10 }))).rejects.toMatchObject({ code: ConversationModelFailureCodes.DeadlineExceeded });
		await vi.advanceTimersByTimeAsync(10);
		await outcome;
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a response received after wall-clock expiry even before the timer callback runs", async function _lateResponse()
	{
		const fetchMock = vi.fn(async function _lateHeaders()
		{
			vi.setSystemTime(_NOW + 25_001);
			return _response();
		});
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.DeadlineExceeded });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("detaches the serialized request before asynchronous caller changes", async function _detachedInput()
	{
		const input = _request();
		const mutableMessages = [{ role: "user" as const, content: "Admitted question." }];
		let resolve: (response: Response) => void = function _unused() { throw new Error("fetch did not start"); };
		const fetchMock = vi.fn(function _pendingResponse(_url: URL, _init: RequestInit)
		{
			return new Promise<Response>(function _captureResponse(accept) { resolve = accept; });
		});
		vi.stubGlobal("fetch", fetchMock);
		const result = __RequestConversationModel({ ...input, compiledInput: { ...input.compiledInput, messages: mutableMessages } });
		mutableMessages[0]!.content = "Changed after dispatch.";
		resolve(_response());
		await result;
		const body = String(fetchMock.mock.calls[0]?.[1]?.body);
		expect(body).toContain("Admitted question.");
		expect(body).not.toContain("Changed after dispatch.");
	});

	it.each([302, 401, 429, 500])("refuses HTTP %s without following or retrying", async function _httpFailure(status)
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response("secret remote error", { status, headers: { location: "https://other.example" } }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.HttpRejected });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1].redirect).toBe("error");
	});

	it("removes the original transport exception before tracing and does not retry a lost response", async function _privateFailure()
	{
		const secret = "sk-private-attempt Private question. remote raw body";
		const fetchMock = vi.fn().mockRejectedValue(new Error(secret));
		vi.stubGlobal("fetch", fetchMock);
		const failure = await __RequestConversationModel(_request()).catch(function _capture(error: unknown) { return error; });
		expect(failure).toBeInstanceOf(ConversationModelError);
		expect(failure).toMatchObject({ code: ConversationModelFailureCodes.TransportFailed });
		expect(failure).not.toHaveProperty("cause");
		expect(_telemetry.errors).toEqual([failure]);
		expect(String(failure)).not.toContain(secret);
		expect(_telemetry.fields).toEqual([{}]);
		expect(_telemetry.suppressed).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["declared", "streamed"])("rejects a %s oversize body and cancels it", async function _responseSize(kind)
	{
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new Uint8Array(700_000)); controller.enqueue(new Uint8Array(400_000)); }, cancel,
		});
		const headers: Record<string, string> = { "content-type": "application/json", "content-length": "1" };
		if (kind === "declared")
			headers["content-length"] = "1048577";
		const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.ResponseTooLarge });
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([{}, { choices: [] }, { choices: [0] }, { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }, {}] },
		{ choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: "partial" } }] },
		{ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok", tool_calls: [] } }] },
		{ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok", function_call: { name: "tool" } } }] },
		{ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok", refusal: "refused" } }] },
		{ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }] },
		_answer(" "), _answer("\ud800"), _answer("é".repeat(32_769)),
	])("rejects malformed or unsupported answer %# without retry", async function _responseShape(body)
	{
		const fetchMock = vi.fn().mockResolvedValue(_response(body));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([new Uint8Array([0xff]), "{", "null"])("rejects malformed UTF-8 or JSON %# without exposing parser errors", async function _malformed(body)
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["text/event-stream", "text/html", ""])("rejects an unsupported response content type %s", async function _contentType(contentType)
	{
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(_answer()), { headers: { "content-type": contentType } }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_request())).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("accepts the existing answer byte ceiling without changing text", async function _textBoundary()
	{
		const text = "é".repeat(32_768);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_response(_answer(text))));
		await expect(__RequestConversationModel(_request())).resolves.toEqual({ kind: ConversationModelResponseKinds.Text, text });
	});
});


/** Creates a frozen tool revision whose schema is independently pinned by its digest. */
function _tool(overrides: Partial<CompiledToolDefinition> = {}): CompiledToolDefinition
{
	const parametersSchema = { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false };
	return { name: "read_file", toolRevisionId: "revision-read-1", description: "Read a file.", requiresApproval: false, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema), ...overrides };
}

/** Supplies two-call budgets; their durable aggregate reservation remains the conversation owner's job. */
function _selection(tools: readonly CompiledToolDefinition[] = [_tool()]): ConversationModelRequest
{
	const input = _request({ tools: ConversationModelToolModes.Select });
	return { ...input, compiledInput: { ...input.compiledInput, tools, budget: { ...input.compiledInput.budget, maxModelTurns: 2, maxToolInvocations: 1 } } };
}

/** Preserves the provider id and original argument text for a paired continuation. */
function _toolCall(overrides: Partial<ConversationModelToolCall> = {}): ConversationModelToolCall
{
	return { id: "call_provider-1", name: "read_file", arguments: '{ "path" : "notes.txt" }', content: null, ...overrides };
}

/** Builds the actual upstream tool envelope without hiding its transport shape behind a model cast. */
function _toolAnswer(call = _toolCall()): Record<string, unknown>
{
	return { choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: call.content,
		tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] } }] };
}

describe("one selected tool and its paired continuation", function _toolExchange()
{
	it("offers every frozen definition and accepts one exact original declaration", async function _firstCall()
	{
		const call = _toolCall({ content: "  Looking it up.\n" });
		const fetchMock = vi.fn().mockResolvedValue(_response(_toolAnswer(call)));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_selection([_tool(), _tool({ name: "write_file", requiresApproval: true })]))).resolves.toEqual({ kind: ConversationModelResponseKinds.Tool, call });
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body));
		expect(body.tools).toEqual([_tool(), _tool({ name: "write_file", requiresApproval: true })].map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parametersSchema } })));
		expect(body).toMatchObject({ tool_choice: "auto", parallel_tool_calls: false, n: 1, stream: false });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(_telemetry.fields).toEqual([{}]);
	});

	it("accepts text when a first call chooses not to propose a tool", async function _textInstead()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_response()));
		await expect(__RequestConversationModel(_selection())).resolves.toEqual({ kind: ConversationModelResponseKinds.Text, text: "  Saved answer.\n" });
	});

	it("offers multiple unambiguous frozen names but still accepts exactly one selection", async function _oneOfMany()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_response(_toolAnswer(_toolCall({ name: "read_notes" })))));
		await expect(__RequestConversationModel(_selection([_tool(), _tool({ name: "read_notes", toolRevisionId: "revision-notes" })]))).resolves.toMatchObject({ kind: ConversationModelResponseKinds.Tool, call: { name: "read_notes" } });
	});

	it("pairs the saved assistant declaration and result after the unchanged compiled messages", async function _secondCall()
	{
		const first = _selection();
		const call = _toolCall({ content: "Checking." });
		const fetchMock = vi.fn().mockResolvedValue(_response());
		vi.stubGlobal("fetch", fetchMock);
		await __RequestConversationModel({ ...first, tools: ConversationModelToolModes.None, continuation: { call, resultContent: '{"result":"Ready"}' } });
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body));
		expect(body.messages).toEqual([
			{ role: "system", content: first.compiledInput.instructions }, ...first.compiledInput.messages,
			{ role: "assistant", content: "Checking.", tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] },
			{ role: "tool", tool_call_id: call.id, content: '{"result":"Ready"}' },
		]);
		for (const field of ["tools", "tool_choice", "parallel_tool_calls"])
			expect(body).not.toHaveProperty(field);
		expect(first.compiledInput.messages).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		[], [_tool(), _tool()],
		[_tool({ name: "not.legal" })], [_tool({ parametersSchemaDigest: "sha256:changed" })],
		[_tool({ parametersSchema: [] })], [_tool({ description: "\ud800" })],
	].map(tools => ({ tools })))("rejects unusable frozen offer %# before dispatch", async function _badOffer({ tools })
	{
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_selection(tools))).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("accepts an approval-gated saved continuation", async function _approvalContinuation()
	{
		const input = _selection([_tool({ requiresApproval: true })]);
		const fetchMock = vi.fn().mockResolvedValue(_response());
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel({ ...input, tools: ConversationModelToolModes.None, continuation: { call: _toolCall(), resultContent: "approved result" } })).resolves.toMatchObject({ kind: ConversationModelResponseKinds.Text });
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it.each([
		_toolCall({ name: "not_offered" }), _toolCall({ id: "" }), _toolCall({ arguments: "[]" }),
		_toolCall({ arguments: '{"path":"\\ud800"}' }), _toolCall({ content: "\ud800" }),
		_toolCall({ arguments: " ".repeat(65_537) }),
	])("rejects invalid or unoffered response %# without retry", async function _badDeclaration(call)
	{
		const fetchMock = vi.fn().mockResolvedValue(_response(_toolAnswer(call)));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_selection())).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["parallel", "extra-call-field", "extra-function-field", "stop-with-tool", "refusal", "partial"])("rejects unsupported tool envelope %s", async function _toolEnvelope(kind)
	{
		const body = _toolAnswer() as { choices: Array<{ finish_reason: string; message: { tool_calls: Array<Record<string, unknown>>; refusal?: string } }> };
		const choice = body.choices[0]!;
		const call = choice.message.tool_calls[0]!;
		if (kind === "parallel")
			choice.message.tool_calls.push(call);
		if (kind === "extra-call-field")
			call["index"] = 0;
		if (kind === "extra-function-field")
			(call["function"] as Record<string, unknown>)["extra"] = "hidden";
		if (kind === "stop-with-tool")
			choice.finish_reason = "stop";
		if (kind === "refusal")
			choice.message.refusal = "No";
		if (kind === "partial")
			choice.finish_reason = "length";
		const fetchMock = vi.fn().mockResolvedValue(_response(body));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel(_selection())).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["unknown", "changed-schema", "select", "oversized", "unicode"])("rejects unusable continuation %s before dispatch", async function _badContinuation(kind)
	{
		const input = _selection([_tool({ requiresApproval: kind === "approval", parametersSchemaDigest: kind === "changed-schema" ? "bad" : _tool().parametersSchemaDigest })]);
		let resultContent = "result";
		if (kind === "oversized")
			resultContent = "x".repeat(65_536);
		if (kind === "unicode")
			resultContent = "\ud800";
		const continuation = { call: _toolCall({ name: kind === "unknown" ? "different" : "read_file" }), resultContent };
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel({ ...input, tools: kind === "select" ? ConversationModelToolModes.Select : ConversationModelToolModes.None, continuation })).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([false, true])("rejects a tool response with tools None, continuation %s", async function _noThirdCall(continuation)
	{
		const fetchMock = vi.fn().mockResolvedValue(_response(_toolAnswer()));
		vi.stubGlobal("fetch", fetchMock);
		await expect(__RequestConversationModel({ ..._selection(), tools: ConversationModelToolModes.None, continuation: continuation ? { call: _toolCall(), resultContent: "result" } : null })).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("captures the offered names before caller mutation can authorize a different returned name", async function _offerMutation()
	{
		const tool = { ..._tool() };
		let accept!: (response: Response) => void;
		const fetchMock = vi.fn(function _pendingResponse(_url: URL, _init: RequestInit) { return new Promise<Response>(function _save(resolve) { accept = resolve; }); });
		vi.stubGlobal("fetch", fetchMock);
		const outcome = expect(__RequestConversationModel(_selection([tool]))).rejects.toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse });
		tool.name = "changed_after_dispatch";
		accept(_response(_toolAnswer(_toolCall({ name: tool.name }))));
		await outcome;
		expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("read_file");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
