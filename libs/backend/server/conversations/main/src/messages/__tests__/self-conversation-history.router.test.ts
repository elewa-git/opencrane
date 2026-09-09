import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";

import { _CreateSelfConversationHistoryRouter } from "../self-conversation-history.router";
import type { SelfConversationHistoryAuthority } from "../self-conversation-history.types";

const _TRACING = vi.hoisted(function _TraceMocks()
{
	return {
		run: vi.fn(async function _Trace(_name: string, _fields: Record<string, unknown>, work: () => Promise<unknown>) { return work(); }),
		failed: vi.fn(),
	};
});

vi.mock("@opencrane/backend/observability", function _Observability()
{
	return { ___DoWithTrace: _TRACING.run, ___MarkActiveSpanFailed: _TRACING.failed };
});

/** Authenticated participant fixture resolved outside browser-controlled request data. */
const _CALLER = { siloId: "silo-1", subjectId: "subject-1", principalId: "principal-1" } as const;

/** Mounts one isolated participant history router with a mocked domain authority. */
function _App(authority: SelfConversationHistoryAuthority, warn: Logger["warn"] = vi.fn(), caller: typeof _CALLER | null = _CALLER)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/conversations", _CreateSelfConversationHistoryRouter({ authority, logger: { warn } as never, resolveCaller: function _Resolve() { return caller; } }));
	return app;
}

describe("_CreateSelfConversationHistoryRouter", function _DescribeRouter()
{
	beforeEach(function _Reset() { vi.clearAllMocks(); });

	it("treats afterPosition as an exclusive decimal cursor", async function _ReadsExclusiveCursor()
	{
		const read = vi.fn().mockResolvedValue({ entries: [], payloads: {}, nextPosition: "7", computer: null });
		const response = await request(_App({ read, postMessage: vi.fn() })).get("/api/v1/me/conversations/conversation-1/history?afterPosition=7");
		expect(response.status).toBe(200);
		expect(read).toHaveBeenCalledWith(_CALLER, "conversation-1", 7n);
		expect(response.body).toEqual({ entries: [], payloads: {}, nextPosition: "7", computer: null });
		expect(_TRACING.run).toHaveBeenCalledWith("conversation.history.read", { siloId: _CALLER.siloId, principalId: _CALLER.principalId }, expect.any(Function));
		expect(_TRACING.failed).not.toHaveBeenCalled();
	});

	it("returns accepted and idempotent message outcomes with distinct success statuses", async function _PostsMessages()
	{
		const postMessage = vi.fn().mockResolvedValueOnce({ outcome: "accepted", position: "2" }).mockResolvedValueOnce({ outcome: "idempotent", position: "2" });
		const app = _App({ read: vi.fn(), postMessage });
		const body = { idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "hello", activation: "none" };
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send(body)).status).toBe(202);
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send(body)).status).toBe(200);
		expect(postMessage).toHaveBeenNthCalledWith(1, _CALLER, "conversation-1", body);
		expect(_TRACING.failed).not.toHaveBeenCalled();
	});

	it("rejects malformed cursors, bodies, and unavailable participant access", async function _RejectsInvalidRequests()
	{
		const authority = { read: vi.fn().mockResolvedValue(null), postMessage: vi.fn().mockResolvedValue(null) };
		const warn = vi.fn();
		const app = _App(authority, warn);
		expect((await request(app).get("/api/v1/me/conversations/conversation-1/history?afterPosition=-1")).status).toBe(400);
		expect((await request(app).get("/api/v1/me/conversations/conversation-1/history")).status).toBe(404);
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send({ idempotencyKey: "bad", text: "hello", activation: "none" })).status).toBe(400);
		expect((await request(app).post("/api/v1/me/conversations/conversation-1/messages").send({ idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "hello", activation: "none" })).status).toBe(404);
		expect(warn).not.toHaveBeenCalled();
		expect(_TRACING.failed).not.toHaveBeenCalled();
	});

	it.each(["read", "post"])("keeps unexpected %s failures opaque while logging safe diagnostics", async function _PrivateFailure(operation)
	{
		const failure = Object.assign(new TypeError("PRIVATE_DATABASE_MESSAGE", { cause: new Error("PRIVATE_CAUSE") }), { code: "P2028", name: "PRIVATE_ERROR_NAME", stack: "PRIVATE_STACK", meta: { query: "PRIVATE_QUERY" } });
		const warn = vi.fn();
		const app = _App({ read: vi.fn().mockRejectedValue(failure), postMessage: vi.fn().mockRejectedValue(failure) }, warn);
		const pending = operation === "read"
			? request(app).get("/api/v1/me/conversations/PRIVATE_PATH/history?afterPosition=7")
			: request(app).post("/api/v1/me/conversations/PRIVATE_PATH/messages").send({ idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "PRIVATE_MESSAGE", activation: "none" });
		const response = await pending;

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "conversation_history_unavailable" });
		expect(warn).toHaveBeenCalledWith({ err: { type: "TypeError", message: "Conversation history operation failed", code: "P2028" }, errorType: "TypeError", siloId: _CALLER.siloId, principalId: _CALLER.principalId }, expect.stringMatching(/^Conversation (history read|message post) unavailable$/));
		expect(warn).toHaveBeenCalledOnce();
		expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE_");
		expect(JSON.stringify(warn.mock.calls)).not.toContain("31c1f1dc");
		expect(_TRACING.failed).toHaveBeenCalledOnce();
		expect(_TRACING.run.mock.calls[0]?.[1]).toEqual({ siloId: _CALLER.siloId, principalId: _CALLER.principalId });
		await expect(_TRACING.run.mock.results[0]?.value).resolves.toBeUndefined();
	});

	it.each([
		{ code: 14, expected: 14 },
		{ code: "ECONNREFUSED", expected: "ECONNREFUSED" },
		{ code: "PRIVATE_KEY", expected: undefined },
		{ code: "P2028 PRIVATE_QUERY", expected: undefined },
		{ code: 600, expected: undefined },
		{ code: Number.NaN, expected: undefined },
	])("limits diagnostic codes to recognized values ($code)", async function _BoundedCode({ code, expected })
	{
		const warn = vi.fn();
		const failure = Object.assign(new Error("PRIVATE_MESSAGE"), { code });
		const response = await request(_App({ read: vi.fn().mockRejectedValue(failure), postMessage: vi.fn() }, warn)).get("/api/v1/me/conversations/conversation-1/history");

		expect(response.status).toBe(503);
		expect(warn.mock.calls[0]?.[0].err.code).toBe(expected);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE_");
	});

	it("does not copy arbitrary thrown objects into logs or trace exceptions", async function _UnknownFailure()
	{
		const warn = vi.fn();
		const response = await request(_App({ read: vi.fn().mockRejectedValue({ name: "PRIVATE_NAME", message: "PRIVATE_MESSAGE", code: 14 }), postMessage: vi.fn() }, warn)).get("/api/v1/me/conversations/conversation-1/history");

		expect(response.status).toBe(503);
		expect(warn.mock.calls[0]?.[0].err).toEqual({ type: "unknown", message: "Conversation history operation failed" });
		await expect(_TRACING.run.mock.results[0]?.value).resolves.toBeUndefined();
	});

	it.each([
		{ error: new Prisma.PrismaClientValidationError("PRIVATE_VALIDATION_DETAILS", { clientVersion: "test" }), type: "PrismaClientValidationError", code: undefined },
		{ error: new Prisma.PrismaClientInitializationError("PRIVATE_CONNECTION_STRING", "test", "P1001"), type: "PrismaClientInitializationError", code: "P1001" },
		{ error: new Prisma.PrismaClientKnownRequestError("PRIVATE_QUERY", { code: "P2028", clientVersion: "test", meta: { query: "PRIVATE_QUERY" } }), type: "PrismaClientKnownRequestError", code: "P2028" },
		{ error: new Prisma.PrismaClientUnknownRequestError("PRIVATE_DATABASE_ERROR", { clientVersion: "test" }), type: "PrismaClientUnknownRequestError", code: undefined },
		{ error: new Prisma.PrismaClientRustPanicError("PRIVATE_ENGINE_ERROR", "test"), type: "PrismaClientRustPanicError", code: undefined },
	])("distinguishes the real $type constructor without copying its details", async function _PrismaDiagnostic({ error, type, code })
	{
		const warn = vi.fn();
		const response = await request(_App({ read: vi.fn().mockRejectedValue(error), postMessage: vi.fn() }, warn)).get("/api/v1/me/conversations/conversation-1/history");

		expect(response.status).toBe(503);
		expect(warn.mock.calls[0]?.[0].err.type).toBe(type);
		expect(warn.mock.calls[0]?.[0].err.code).toBe(code);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE_");
		await expect(_TRACING.run.mock.results[0]?.value).resolves.toBeUndefined();
	});

	it("ignores arbitrary names and never invokes an error code getter", async function _UntrustedDiagnosticProperties()
	{
		const warn = vi.fn();
		const failure = Object.assign(new Error("PRIVATE_MESSAGE"), { name: "PRIVATE_NAME" });
		const getter = vi.fn(function _PrivateCode() { throw new Error("PRIVATE_GETTER_ERROR"); });
		Object.defineProperty(failure, "code", { get: getter });
		const response = await request(_App({ read: vi.fn().mockRejectedValue(failure), postMessage: vi.fn() }, warn)).get("/api/v1/me/conversations/conversation-1/history");

		expect(response.status).toBe(503);
		expect(warn.mock.calls[0]?.[0].err).toEqual({ type: "Error", message: "Conversation history operation failed" });
		expect(getter).not.toHaveBeenCalled();
		await expect(_TRACING.run.mock.results[0]?.value).resolves.toBeUndefined();
	});

	it("preserves the Prisma class through the real application logger serializer", async function _SerializedDiagnostic()
	{
		const observability = await vi.importActual<typeof import("@opencrane/backend/observability")>("@opencrane/backend/observability");
		const directory = mkdtempSync(join(tmpdir(), "opencrane-history-diagnostic-"));
		const path = join(directory, "diagnostic.jsonl");
		const descriptor = openSync(path, "w");
		try
		{
			// Production selects stdout or stderr; this test supplies an open file descriptor to inspect the same serializer.
			const logger = observability.___CreateLogger("history-diagnostic-test", { destination: descriptor as 1, pretty: false, level: "warn" });
			const failure = new Prisma.PrismaClientValidationError("PRIVATE_QUERY_AND_VALUES", { clientVersion: "test" });
			const response = await request(_App({ read: vi.fn().mockRejectedValue(failure), postMessage: vi.fn() }, logger.warn.bind(logger))).get("/api/v1/me/conversations/conversation-1/history");
			const emitted = readFileSync(path, "utf8");
			const record = JSON.parse(emitted) as { errorType: string; err: { message: string } };

			expect(response.status).toBe(503);
			expect(record.errorType).toBe("PrismaClientValidationError");
			expect(record.err.message).toBe("Conversation history operation failed");
			expect(emitted).not.toContain("PRIVATE_");
		}
		finally
		{
			closeSync(descriptor);
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each(["idempotency conflict with PRIVATE_MESSAGE", "cannot activate PRIVATE_COMMAND"])("keeps expected message conflicts quiet", async function _ExpectedConflict(message)
	{
		const warn = vi.fn();
		const app = _App({ read: vi.fn(), postMessage: vi.fn().mockRejectedValue(new Error(message)) }, warn);
		const response = await request(app).post("/api/v1/me/conversations/conversation-1/messages").send({ idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", text: "hello", activation: "none" });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "message_conflict" });
		expect(warn).not.toHaveBeenCalled();
		expect(_TRACING.failed).not.toHaveBeenCalled();
		await expect(_TRACING.run.mock.results[0]?.value).resolves.toBeUndefined();
	});

	it("keeps unauthenticated requests outside the history operation", async function _Unauthorized()
	{
		const warn = vi.fn();
		const app = _App({ read: vi.fn(), postMessage: vi.fn() }, warn, null);
		expect((await request(app).get("/api/v1/me/conversations/conversation-1/history")).status).toBe(401);
		expect(warn).not.toHaveBeenCalled();
		expect(_TRACING.run).not.toHaveBeenCalled();
	});
});
