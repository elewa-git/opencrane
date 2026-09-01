import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import { __CreateConversationComputerRuntimeBootstrapRouter } from "../conversation-computer-runtime-bootstrap.router";
import type { ConversationComputerRuntimeAdmissionDependencies } from "../conversation-computer-runtime-admission.types";

/** Supplies the reviewed Sandbox Pod identity stored by the active lease fixture. */
const _IDENTITY = { namespace: "conversation-computers", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" } as const;

/** Supplies a current active execution that the history authority derived from a trusted computer. */
const _ACTIVE_EXECUTION = {
	computer: { id: "computer-1", conversationId: "conversation-1" },
	lease: { generation: 4, runtimePod: _IDENTITY },
	execution: { id: "execution-1" },
} as never;

/** Build one isolated route with a controllable reviewed identity and active-history result. */
function _App(overrides: Partial<ConversationComputerRuntimeAdmissionDependencies> = {})
{
	const dependencies: ConversationComputerRuntimeAdmissionDependencies = {
		history: { loadActiveExecutionForBootstrap: vi.fn().mockResolvedValue(_ACTIVE_EXECUTION) },
		tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) },
		siloId: "silo-1",
		clock: { now: function _Now() { return new Date("2026-09-01T00:10:00.000Z"); } },
		logger: { error: vi.fn(), warn: vi.fn() } as never,
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateConversationComputerRuntimeBootstrapRouter(dependencies));
	return { app, dependencies };
}

/** Builds the bearer header used by a projected Sandbox token fixture. */
function _Bearer(): { readonly authorization: string }
{
	return { authorization: "Bearer projected-token" };
}

describe("ConversationComputer runtime bootstrap router", function _ConversationComputerRuntimeBootstrapRouter()
{
	it("returns only the server-derived active execution after the reviewed Pod matches its lease", async function _BootstrapsReviewedLeasePod()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/bootstrap").set(_Bearer()).send({ computerId: "computer-1" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ computerId: "computer-1", conversationId: "conversation-1", executionId: "execution-1", leaseGeneration: 4 });
		expect(dependencies.history.loadActiveExecutionForBootstrap).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", nowEpochMilliseconds: Date.parse("2026-09-01T00:10:00.000Z") });
	});

	it("refuses an unreviewed caller before it can read the selected computer history", async function _RefusesUnreviewedCaller()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });

		const response = await request(app).post("/bootstrap").set(_Bearer()).send({ computerId: "computer-1" });

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "runtime_denied" });
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
	});

	it("refuses a body that tries to add a caller-selected execution coordinate", async function _RefusesExpandedBody()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/bootstrap").set(_Bearer()).send({ computerId: "computer-1", executionId: "forged-execution" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "invalid_runtime_bootstrap" });
		expect(dependencies.history.loadActiveExecutionForBootstrap).not.toHaveBeenCalled();
	});

	it("refuses a reviewed Sandbox Pod when its UID or ServiceAccount differs from the active lease", async function _RefusesReplacedPod()
	{
		const wrongPod = { ..._IDENTITY, podUid: "pod-uid-2" };
		const { app } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(wrongPod) } });

		const response = await request(app).post("/bootstrap").set(_Bearer()).send({ computerId: "computer-1" });

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "runtime_denied" });
	});

	it("refuses an inactive history result without exposing whether the computer exists", async function _RefusesInactiveHistory()
	{
		const { app, dependencies } = _App({ history: { loadActiveExecutionForBootstrap: vi.fn().mockRejectedValue(new Error("inactive runtime")) } });

		const response = await request(app).post("/bootstrap").set(_Bearer()).send({ computerId: "computer-1" });

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "runtime_denied" });
		expect(dependencies.logger.warn).toHaveBeenCalledOnce();
	});
});
