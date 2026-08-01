import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { RunAdmissionConcurrencyDenialReasons } from "@opencrane/backend/agents/execution/runs";
import type { Logger } from "@opencrane/observability";

import { __CreatePersonalRunAdmissionRouter } from "../personal-run-admission.router.js";
import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, type PersonalRunAdmissionPort } from "../personal-run-admission.types.js";

/** Builds a JSON-enabled route and records the trusted caller-derived port invocation. */
function _App(caller: unknown, admission: PersonalRunAdmissionPort)
{
	const app = express();
	app.use(express.json());
	app.use(__CreatePersonalRunAdmissionRouter({ resolveCaller: function _resolveCaller() { return caller as never; }, admission, logger: { error: vi.fn() } as unknown as Logger }));
	return app;
}

/** Builds a personal admission port whose result is deterministic for the transport test. */
function _Admission(result: Awaited<ReturnType<PersonalRunAdmissionPort["admitPersonalRun"]>>)
{
	const admitPersonalRun = vi.fn(async function _admitPersonalRun() { return result; });
	return { admission: { admitPersonalRun }, admitPersonalRun };
}

describe("personal run admission router", function _describePersonalRunAdmissionRouter()
{
	it("requires trusted browser identity before a run can be requested", async function _requiresSession()
	{
		const fixture = _Admission({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" });
		await expect(request(_App(null, fixture.admission)).post("/").send({ threadId: "thread-1", requestIdempotencyKey: "request-1" })).resolves.toMatchObject({ status: 401 });
		expect(fixture.admitPersonalRun).not.toHaveBeenCalled();
	});

	it("rejects forged authority coordinates and datasets instead of passing them to admission", async function _rejectsForgedFields()
	{
		const fixture = _Admission({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" });
		const response = await request(_App({ siloId: "silo-1", subjectId: "user-1" }, fixture.admission)).post("/").send({ threadId: "thread-1", requestIdempotencyKey: "request-1", siloId: "silo-forged", datasetId: "dataset-forged" });
		expect(response.status).toBe(400);
		expect(fixture.admitPersonalRun).not.toHaveBeenCalled();
	});

	it("derives every authority coordinate from the trusted caller", async function _derivesTrustedCoordinates()
	{
		const fixture = _Admission({ outcome: PersonalRunAdmissionOutcomes.Accepted, runId: "run-1" });
		const response = await request(_App({ siloId: "silo-1", subjectId: "user-1" }, fixture.admission)).post("/").send({ threadId: "thread-1", requestIdempotencyKey: "request-1" });
		expect(response.status).toBe(201);
		expect(response.body).toEqual({ runId: "run-1" });
		expect(fixture.admitPersonalRun).toHaveBeenCalledWith({ siloId: "silo-1", executionSubjectId: "user-1", threadId: "thread-1", requestIdempotencyKey: "request-1" });
	});

	it("maps shared admission overload to an explicit retryable response", async function _mapsOverload()
	{
		const fixture = _Admission({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited });
		const response = await request(_App({ siloId: "silo-1", subjectId: "user-1" }, fixture.admission)).post("/").send({ threadId: "thread-1", requestIdempotencyKey: "request-1" });
		expect(response.status).toBe(429);
	});

	it("maps a durable admission outage to a retryable response", async function _mapsPersistenceFailure()
	{
		const fixture = _Admission({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.PersistenceUnavailable });
		const response = await request(_App({ siloId: "silo-1", subjectId: "user-1" }, fixture.admission)).post("/").send({ threadId: "thread-1", requestIdempotencyKey: "request-1" });
		expect(response.status).toBe(503);
	});
});
