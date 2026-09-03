import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeCommandKinds, ConversationComputerRuntimeTerminalStates, type ConversationComputerRuntimeCommandEnvelope } from "@opencrane/contracts";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { __CreateConversationComputerRuntimeCommandRouter } from "../conversation-computer-runtime-command.router";
import type { ConversationComputerRuntimeCommandRouterDependencies } from "../conversation-computer-runtime-command.router.types";

/** Supplies the reviewed Sandbox Pod identity recorded by the active lease fixture. */
const _IDENTITY = { namespace: "conversation-computers", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" } as const;
/** Supplies the active execution whose coordinates a runtime route must derive. */
const _ACTIVE = { computer: { id: "computer-1", conversationId: "conversation-1" }, execution: { id: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651" }, lease: { generation: 2, runtimePod: _IDENTITY } } as never;
/** Supplies one durable head command returned to the reviewed Sandbox. */
const _COMMAND = { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", sequence: 1, computerId: "computer-1", executionId: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651", leaseGeneration: 2, issuedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-01T00:05:00.000Z", kind: ConversationComputerRuntimeCommandKinds.StartTurn, payload: { inputEntryId: "input-1", inputPayloadRef: "payload://input-1", inputPayloadDigest: `sha256:${"a".repeat(64)}` } } as const satisfies ConversationComputerRuntimeCommandEnvelope;

/** Builds one internal router with controlled identity, history, and queue ports. */
function _App(overrides: Partial<ConversationComputerRuntimeCommandRouterDependencies> = {})
{
	const dependencies: ConversationComputerRuntimeCommandRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) },
		history: { loadActiveExecutionForBootstrap: vi.fn().mockResolvedValue(_ACTIVE) },
		authority: { poll: vi.fn().mockResolvedValue({ command: _COMMAND }), complete: vi.fn().mockResolvedValue(undefined) },
		siloId: "testv5",
		clock: { now: function _Now() { return new Date("2026-09-01T00:00:00.000Z"); } },
		logger: { warn: vi.fn(), error: vi.fn() } as never,
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateConversationComputerRuntimeCommandRouter(dependencies));
	return { app, dependencies };
}

/** Builds the bearer header used by the projected Sandbox token fixture. */
function _Bearer()
{
	return { authorization: "Bearer projected-token" };
}

/** Builds one terminal report that can complete the active head command. */
function _Report()
{
	return { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: _COMMAND.commandId, computerId: "computer-1", executionId: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651", leaseGeneration: 2, state: ConversationComputerRuntimeTerminalStates.Completed };
}

describe("ConversationComputer runtime command router", function _ConversationComputerRuntimeCommandRouter()
{
	it("returns the oldest durable command only after the reviewed Pod matches its active lease", async function _ReturnsHeadCommand()
	{
		const { app, dependencies } = _App();

		const response = await request(app).get("/commands/next?computerId=computer-1").set(_Bearer());

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ command: _COMMAND });
		expect(dependencies.authority.poll).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1" });
	});

	it("refuses an unreviewed caller before it reads active computer history", async function _RefusesUnreviewedCaller()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });

		const response = await request(app).get("/commands/next?computerId=computer-1").set(_Bearer());

		expect(response.status).toBe(401);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.poll).not.toHaveBeenCalled();
	});

	it("refuses a reviewed replacement Pod before it can poll a former lease", async function _RefusesReplacementPod()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ ..._IDENTITY, podUid: "pod-uid-2" }) } });

		const response = await request(app).get("/commands/next?computerId=computer-1").set(_Bearer());

		expect(response.status).toBe(403);
		expect(dependencies.authority.poll).not.toHaveBeenCalled();
	});

	it("returns no content when the durable queue has no pending command", async function _ReturnsEmptyQueue()
	{
		const { app } = _App({ authority: { poll: vi.fn().mockResolvedValue({ command: null }), complete: vi.fn() } });

		const response = await request(app).get("/commands/next?computerId=computer-1").set(_Bearer());

		expect(response.status).toBe(204);
	});

	it("completes only a strict terminal report against server-derived active coordinates", async function _CompletesHeadCommand()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/commands/complete").set(_Bearer()).send(_Report());

		expect(response.status).toBe(204);
		expect(dependencies.authority.complete).toHaveBeenCalledWith({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", report: _Report() });
	});

	it("refuses a terminal report with an extra runtime-controlled field before history reads", async function _RefusesExpandedReport()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/commands/complete").set(_Bearer()).send({ ..._Report(), details: "untrusted" });

		expect(response.status).toBe(400);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.complete).not.toHaveBeenCalled();
	});

	it("refuses malformed terminal coordinates before history reads", async function _RefusesMalformedReport()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/commands/complete").set(_Bearer()).send({ ..._Report(), executionId: "not-a-uuid", leaseGeneration: 0 });

		expect(response.status).toBe(400);
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
		expect(dependencies.authority.complete).not.toHaveBeenCalled();
	});
});
