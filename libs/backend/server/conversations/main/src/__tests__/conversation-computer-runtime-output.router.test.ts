import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { __CreateConversationComputerRuntimeOutputRouter } from "../conversation-computer-runtime-output.router";
import type { ConversationComputerRuntimeOutputRouterDependencies } from "../conversation-computer-runtime-output.router.types";

/** Supplies the reviewed Sandbox Pod identity recorded by the active lease fixture. */
const _IDENTITY = { namespace: "conversation-computers", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" } as const;
/** Supplies the active execution whose output coordinates the route must derive. */
const _ACTIVE = { computer: { id: "computer-1", conversationId: "conversation-1", profileRevisionId: "profile-1" }, execution: { id: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651" }, lease: { generation: 2, runtimePod: _IDENTITY } } as never;
/** Supplies the server-issued command identifier accepted by the strict output request. */
const _COMMAND_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds one internal output router with controlled admission and persistence ports. */
function _App(overrides: Partial<ConversationComputerRuntimeOutputRouterDependencies> = {})
{
	const dependencies: ConversationComputerRuntimeOutputRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) },
		history: { loadActiveExecutionForBootstrap: vi.fn().mockResolvedValue(_ACTIVE) },
		authority: { record: vi.fn().mockResolvedValue({ messageId: "message-1" }) },
		siloId: "testv5",
		clock: { now: function _Now() { return new Date("2026-09-01T00:00:00.000Z"); } },
		logger: { warn: vi.fn(), error: vi.fn() } as never,
		...overrides,
	};
	const app = express();
	app.use(express.json({ limit: 64 * 1_024, strict: true }));
	app.use(__CreateConversationComputerRuntimeOutputRouter(dependencies));
	return { app, dependencies };
}

/** Builds the bearer header used by the projected Sandbox token fixture. */
function _Bearer()
{
	return { authorization: "Bearer projected-token" };
}

/** Builds the only three caller-controlled fields accepted by the runtime output endpoint. */
function _Output()
{
	return { computerId: "computer-1", commandId: _COMMAND_ID, text: "the completed answer" };
}

describe("ConversationComputer runtime output router", function _ConversationComputerRuntimeOutputRouter()
{
	it("records output only with active execution and author coordinates derived by the server", async function _RecordsDerivedOutput()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/output").set(_Bearer()).send(_Output());

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ messageId: "message-1" });
		expect(dependencies.authority.record).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", executionId: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651", leaseGeneration: 2, profileRevisionId: "profile-1", commandId: _COMMAND_ID, text: "the completed answer" });
	});

	it("refuses an unreviewed caller before it parses output or reads active computer history", async function _RefusesUnreviewedCaller()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });

		const response = await request(app).post("/output").set(_Bearer()).send({ computerId: "not-read", commandId: "not-read", text: "not-read" });

		expect(response.status).toBe(401);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.record).not.toHaveBeenCalled();
	});

	it("refuses a reviewed replacement Pod before it can record output for a former lease", async function _RefusesReplacementPod()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ ..._IDENTITY, podUid: "pod-uid-2" }) } });

		const response = await request(app).post("/output").set(_Bearer()).send(_Output());

		expect(response.status).toBe(403);
		expect(dependencies.authority.record).not.toHaveBeenCalled();
	});

	it("rejects added runtime coordinates before it reads history or writes a payload", async function _RefusesExpandedOutput()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/output").set(_Bearer()).send({ ..._Output(), executionId: "caller-controlled" });

		expect(response.status).toBe(400);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.record).not.toHaveBeenCalled();
	});

	it("rejects malformed output before it reads history or writes a payload", async function _RefusesMalformedOutput()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/output").set(_Bearer()).send({ ..._Output(), commandId: "not-a-uuid" });

		expect(response.status).toBe(400);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.record).not.toHaveBeenCalled();
	});

	it("rejects oversized output before it can read history or write a payload", async function _RefusesOversizedOutput()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/output").set(_Bearer()).send({ ..._Output(), text: "x".repeat(64 * 1_024 + 1) });

		expect(response.status).toBe(413);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.record).not.toHaveBeenCalled();
	});

	it("returns one denial when the durable authority rejects a foreign or stale command", async function _RefusesAuthorityDenial()
	{
		const { app, dependencies } = _App({ authority: { record: vi.fn().mockRejectedValue(new Error("foreign runtime command")) } });

		const response = await request(app).post("/output").set(_Bearer()).send(_Output());

		expect(response.status).toBe(403);
		expect(dependencies.authority.record).toHaveBeenCalledTimes(1);
	});
});
