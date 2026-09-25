import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

import { PersonalMemoryCommandAdmissionOutcomes, PersonalMemoryCommandConflict, PersonalMemoryCommandStates } from "../personal-memory-command-authority.types";
import { _CreatePersonalMemoryCommandRouter } from "../personal-memory-command.router";
import type { PersonalMemoryCommandRouterDependencies } from "../personal-memory-command.router.types";

/** Authenticated caller fixture used by all route tests. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "subject-1" } as const;
/** Valid Remember command fixture. */
const _COMMAND = { commandId: "01933f22-7c4b-7abc-8def-0123456789ab", kind: PersonalMemoryOperationKinds.Remember, source: { conversationId: "conversation-1", messageId: "message-1", messagePosition: "7" } } as const;
/** Valid Correct command fixture. */
const _CORRECT_COMMAND = { commandId: "01933f22-7c4b-7abc-8def-0123456789ac", kind: PersonalMemoryOperationKinds.Correct, source: _COMMAND.source, targetFactId: "fact-1", expectedFactRevision: 3 } as const;
/** Valid Forget command fixture. */
const _FORGET_COMMAND = { commandId: "01933f22-7c4b-7abc-8def-0123456789ad", kind: PersonalMemoryOperationKinds.Forget, targetFactId: "fact-1", expectedFactRevision: 3 } as const;
/** Safe receipt fixture with no internal authority coordinates. */
const _RECEIPT = { commandId: _COMMAND.commandId, operationId: "b8a2f0a8-8dd9-4a0c-9fd4-527fe9e7bdf0", kind: PersonalMemoryOperationKinds.Remember, state: PersonalMemoryCommandStates.Pending, revision: 1, resultFactId: null } as const;

/** Builds an isolated Express app around one injected authority. */
function _App(authority: PersonalMemoryCommandRouterDependencies["authority"], caller: typeof _CALLER | null = _CALLER, warn = vi.fn())
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/memory", _CreatePersonalMemoryCommandRouter({ authority, resolveCaller: function _Resolve() { return caller; }, logger: { warn } }));
	return { app, warn };
}

describe("_CreatePersonalMemoryCommandRouter", function _Suite()
{
	it("authenticates before parsing malformed input", async function _AuthFirst()
	{
		const admit = vi.fn();
		const response = await request(_App({ admit, read: vi.fn() }, null).app).post("/api/v1/me/memory/commands").send({ invalid: true });
		expect(response.status).toBe(401);
		expect(admit).not.toHaveBeenCalled();
	});

	it("admits each closed command kind and projects the receipt", async function _AdmitsCommands()
	{
		const admit = vi.fn().mockResolvedValue({ outcome: PersonalMemoryCommandAdmissionOutcomes.Accepted, receipt: { ..._RECEIPT, kind: PersonalMemoryOperationKinds.Remember, internalPhase: "secret" } });
		const response = await request(_App({ admit, read: vi.fn() }).app).post("/api/v1/me/memory/commands").send(_COMMAND);
		expect(response.status).toBe(202);
		expect(response.body).toEqual({ outcome: "accepted", receipt: _RECEIPT });
	});

	it("admits valid Correct and Forget commands", async function _AdmitsCorrectionsAndForget()
	{
		const admit = vi.fn().mockResolvedValue({ outcome: PersonalMemoryCommandAdmissionOutcomes.Accepted, receipt: _RECEIPT });
		const app = _App({ admit, read: vi.fn() }).app;
		expect((await request(app).post("/api/v1/me/memory/commands").send(_CORRECT_COMMAND)).status).toBe(202);
		expect((await request(app).post("/api/v1/me/memory/commands").send(_FORGET_COMMAND)).status).toBe(202);
		expect(admit).toHaveBeenNthCalledWith(1, _CALLER, _CORRECT_COMMAND);
		expect(admit).toHaveBeenNthCalledWith(2, _CALLER, _FORGET_COMMAND);
	});

	it("returns idempotent retry, conflict, and unavailable outcomes", async function _Outcomes()
	{
		const authority = { admit: vi.fn().mockResolvedValueOnce({ outcome: PersonalMemoryCommandAdmissionOutcomes.Idempotent, receipt: _RECEIPT }).mockRejectedValueOnce(new PersonalMemoryCommandConflict()), read: vi.fn() };
		const app = _App(authority).app;
		expect((await request(app).post("/api/v1/me/memory/commands").send(_COMMAND)).status).toBe(200);
		expect((await request(app).post("/api/v1/me/memory/commands").send(_COMMAND)).status).toBe(409);
	});

	it("reads without dispatch and hides absent receipts", async function _ReadsReceipt()
	{
		const read = vi.fn().mockResolvedValue({ ..._RECEIPT, providerDatasetId: "private", approvalGrantId: "private" });
		const app = _App({ admit: vi.fn(), read }).app;
		const response = await request(app).get(`/api/v1/me/memory/commands/${_COMMAND.commandId}`);
		expect(response.status).toBe(200);
		expect(response.body).toEqual(_RECEIPT);
		expect(read).toHaveBeenCalledWith(_CALLER, _COMMAND.commandId);
	});

	it("returns 404 for absent commands and 404 when admission has no receipt", async function _HidesAbsentCommands()
	{
		const authority = { admit: vi.fn().mockResolvedValue(null), read: vi.fn().mockResolvedValue(null) };
		const app = _App(authority).app;
		expect((await request(app).post("/api/v1/me/memory/commands").send(_COMMAND)).status).toBe(404);
		expect((await request(app).get(`/api/v1/me/memory/commands/${_COMMAND.commandId}`)).status).toBe(404);
	});

	it("rejects unauthenticated reads and query-bearing reads", async function _ReadGuards()
	{
		const unauthenticated = _App({ admit: vi.fn(), read: vi.fn() }, null).app;
		expect((await request(unauthenticated).get(`/api/v1/me/memory/commands/${_COMMAND.commandId}`)).status).toBe(401);

		const read = vi.fn();
		const response = await request(_App({ admit: vi.fn(), read }).app).get(`/api/v1/me/memory/commands/${_COMMAND.commandId}`).query({ extra: "rejected" });
		expect(response.status).toBe(400);
		expect(read).not.toHaveBeenCalled();
	});

	it("returns a safe 503 for provider-shaped failures", async function _ScrubsProviderFailure()
	{
		const warn = vi.fn();
		const error = new Error("providerDatasetId=private-dataset providerToken=secret-token");
		const authority = { admit: vi.fn().mockRejectedValue(error), read: vi.fn() };
		const response = await request(_App(authority, _CALLER, warn).app).post("/api/v1/me/memory/commands").send(_COMMAND);
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "memory_command_unavailable" });
		expect(JSON.stringify(warn.mock.calls)).not.toContain("private-dataset");
		expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
	});

	it("rejects malformed command UUIDs consistently", async function _RejectsInvalidUuid()
	{
		const authority = { admit: vi.fn(), read: vi.fn() };
		const app = _App(authority).app;
		expect((await request(app).post("/api/v1/me/memory/commands").send({ ..._COMMAND, commandId: "not-a-uuid" })).status).toBe(400);
		expect((await request(app).get("/api/v1/me/memory/commands/not-a-uuid")).status).toBe(400);
		expect(authority.read).not.toHaveBeenCalled();
	});
});
