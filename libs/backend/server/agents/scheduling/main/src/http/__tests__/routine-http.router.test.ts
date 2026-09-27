import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { RoutineFiringReasons } from "@opencrane/contracts";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "@opencrane/models/agents";

import { RoutineCommandConflictError, RoutineCommandUnavailableError, RoutineCommandValidationError } from "../../routine-command.errors";
import { RoutineCommandOutcome } from "../../routine-authority.types";
import type { RoutineHttpAuthority, RoutineRequestPrincipalResolver } from "../routine-http.types";
import { __CreateRoutineRouter } from "../routine-http.router";

/** Authenticated Principal supplied to every successful route. */
const _PRINCIPAL = { siloId: "silo-1", principalId: "principal-1", externalIssuer: "https://issuer.example", externalSubject: "subject-1", verifiedAuthenticationAt: new Date("2026-09-27T08:00:00.000Z") };

/** Routine definition returned by mutation doubles. */
const _DEFINITION = { outcome: RoutineCommandOutcome.Committed, routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, nextAutomaticOccurrence: "2026-09-28T08:00:00.000Z" };

/** Builds all seven authority operations with stable successful results. */
function _Authority(): RoutineHttpAuthority
{
	return {
		create: vi.fn().mockResolvedValue(_DEFINITION),
		read: vi.fn().mockResolvedValue({ ..._DEFINITION, ownership: "owner", destinationConversationId: "conversation-source", selectedManagedService: { managedServiceId: "service-1", displayName: "Service" }, requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-27T08:00:00.000Z", schedule: { expression: "0 8 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "Owner", isSelf: true }], instruction: "Prepare a summary." }),
		revise: vi.fn().mockResolvedValue(_DEFINITION),
		pause: vi.fn().mockResolvedValue({ ..._DEFINITION, status: RoutineStatus.Paused, nextAutomaticOccurrence: null }),
		resume: vi.fn().mockResolvedValue(_DEFINITION),
		retire: vi.fn().mockResolvedValue({ ..._DEFINITION, status: RoutineStatus.Retired, nextAutomaticOccurrence: null }),
		runNow: vi.fn().mockResolvedValue({ outcome: RoutineCommandOutcome.Committed, firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, conversationId: "conversation-1", scheduledSlot: null, reason: null }),
		list: vi.fn().mockResolvedValue({ items: [{ routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, ownership: "owner", destinationConversationId: "conversation-source", selectedManagedService: { managedServiceId: "service-1", displayName: "Service" }, schedule: { expression: "0 8 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, nextAutomaticOccurrence: "2026-09-28T08:00:00.000Z", lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, requesterSubjectId: "private-subject" } as never], limit: 20, taskId: "private-task" } as never),
		firings: vi.fn().mockResolvedValue({ items: [{ firingId: "firing-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, scheduledSlot: null, createdAt: "2026-09-27T08:00:00.000Z", finishedAt: null, reason: null, runTerminalReason: null, resultConversationId: null, actualCost: null, taskId: "private-task" } as never], limit: 20, requesterSubjectId: "private-subject" } as never),
		creationOptions: vi.fn().mockResolvedValue({ destinationConversationId: "conversation-source", audienceChoices: [], managedServiceChoices: [] }),
		preview: vi.fn().mockResolvedValue({ schedule: { expression: "0 8 * * *", timezone: "UTC" }, calculatedAt: "2026-09-27T08:00:00.000Z", nextOccurrences: ["2026-09-28T08:00:00.000Z", "2026-09-29T08:00:00.000Z", "2026-09-30T08:00:00.000Z", "2026-10-01T08:00:00.000Z", "2026-10-02T08:00:00.000Z"] }),
	};
}

/** Mounts the router with an injected trusted caller resolver. */
function _App(authority: RoutineHttpAuthority, resolvePrincipal: RoutineRequestPrincipalResolver = function _Resolve() { return _PRINCIPAL; }, warn = vi.fn())
{
	const app = express();
	app.use(express.json());
	app.use(__CreateRoutineRouter(authority, { warn }, resolvePrincipal));
	return { app, warn };
}

describe("routine HTTP router", function _Suite()
{
	it("creates and reads through the trusted caller while omitting private identity and storage fields", async function _CreateAndRead()
	{
		const authority = _Authority();
		const fixture = _App(authority);
		const createBody = { destinationConversationId: "conversation-source", audienceParticipantRefs: ["participant-1"], selectedManagedServiceId: "service-1", schedule: { expression: "0 8 * * *", timezone: "UTC" }, instruction: "Prepare a summary.", idempotencyKey: "create-1" };

		const created = await request(fixture.app).post("/").send(createBody).expect(201).expect("cache-control", "no-store");
		const read = await request(fixture.app).get("/routine-1").expect(200).expect("cache-control", "no-store");

		expect(created.body).toEqual({ routine: { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, nextAutomaticOccurrence: "2026-09-28T08:00:00.000Z" } });
		expect(authority.create).toHaveBeenCalledWith(expect.objectContaining({ caller: expect.objectContaining({ principalId: "principal-1" }), audienceParticipantRefs: ["participant-1"] }));
		expect(read.body.routine).toEqual(expect.objectContaining({ routineId: "routine-1", ownership: "owner", destinationConversationId: "conversation-source", selectedManagedService: { managedServiceId: "service-1", displayName: "Service" }, audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "Owner", isSelf: true }], instruction: "Prepare a summary." }));
		expect(JSON.stringify(read.body)).not.toContain("issuer.example");
		expect(JSON.stringify(read.body)).not.toContain("authenticatedAt");
		expect(JSON.stringify(read.body)).not.toContain("ciphertext");
		expect(JSON.stringify(read.body)).not.toContain("outcome");
	});

	it("routes revision, lifecycle and run-now commands with normalized public payloads", async function _Commands()
	{
		const authority = _Authority();
		const fixture = _App(authority);
		const control = { expectedLifecycleRevision: 3, idempotencyKey: "command-1" };
		const revise = { expectedRevision: 2, expectedLifecycleRevision: 3, schedule: { expression: "0 9 * * *", timezone: "UTC" }, instruction: "Prepare another summary.", idempotencyKey: "revise-1" };

		await request(fixture.app).post("/routine-1/revise").send(revise).expect(200);
		await request(fixture.app).post("/routine-1/pause").send(control).expect(200);
		await request(fixture.app).post("/routine-1/resume").send(control).expect(200);
		await request(fixture.app).post("/routine-1/retire").send(control).expect(200);
		const firing = await request(fixture.app).post("/routine-1/run-now").send(control).expect(200);

		expect(authority.revise).toHaveBeenCalledWith(expect.objectContaining({ routineId: "routine-1", expectedRevision: 2 }));
		expect(authority.pause).toHaveBeenCalledWith(expect.objectContaining({ routineId: "routine-1", expectedLifecycleRevision: 3 }));
		expect(authority.resume).toHaveBeenCalledOnce();
		expect(authority.retire).toHaveBeenCalledOnce();
		expect(firing.body).toEqual({ firing: { firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, scheduledSlot: null, reason: null } });
	});

	it("routes list, firing history, creation options and schedule preview before dynamic IDs", async function _ReadRoutes()
	{
		const authority = _Authority();
		const fixture = _App(authority);
		const list = await request(fixture.app).get("/?limit=25&cursor=encrypted_cursor").expect(200);
		const firings = await request(fixture.app).get("/routine-1/firings?limit=5").expect(200);
		await request(fixture.app).get("/creation-options?destinationConversationId=conversation-source").expect(200);
		await request(fixture.app).post("/schedule-preview").send({ schedule: { expression: "0 8 * * *", timezone: "UTC" } }).expect(200);

		expect(authority.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, cursor: "encrypted_cursor" }));
		expect(authority.firings).toHaveBeenCalledWith(expect.objectContaining({ routineId: "routine-1", limit: 5 }));
		expect(authority.creationOptions).toHaveBeenCalledWith(expect.objectContaining({ destinationConversationId: "conversation-source" }));
		expect(authority.preview).toHaveBeenCalledWith(expect.objectContaining({ schedule: { expression: "0 8 * * *", timezone: "UTC" } }));
		expect(JSON.stringify(list.body)).not.toContain("private-subject");
		expect(JSON.stringify(firings.body)).not.toContain("private-task");
	});

	it("rejects missing authentication, invalid authentication instants and body-owned identity", async function _Authentication()
	{
		const authority = _Authority();
		const missing = _App(authority, function _Missing() { return null; });
		const invalid = _App(authority, function _Invalid() { return { ..._PRINCIPAL, verifiedAuthenticationAt: null }; });
		const body = { destinationConversationId: "conversation-source", audienceParticipantRefs: ["participant-1"], selectedManagedServiceId: "service-1", schedule: { expression: "0 8 * * *", timezone: "UTC" }, instruction: "Prepare a summary.", idempotencyKey: "create-1", siloId: "attacker-silo" };

		await request(missing.app).get("/routine-1").expect(401, { error: "routine_authentication_required" });
		await request(invalid.app).get("/routine-1").expect(401, { error: "routine_authentication_required" });
		await request(_App(authority).app).post("/").send(body).expect(400, { error: "invalid_routine_command" });
		expect(authority.create).not.toHaveBeenCalled();
	});

	it.each([
		[new RoutineCommandValidationError("private validation detail"), 400, "invalid_routine_command"],
		[new RoutineCommandUnavailableError("private authorization detail"), 404, "routine_unavailable"],
		[new RoutineCommandConflictError("private conflict detail"), 409, "routine_conflict"],
	])("maps an expected domain failure without logging it", async function _Expected(error, status, code)
	{
		const authority = _Authority();
		vi.mocked(authority.read).mockRejectedValue(error);
		const fixture = _App(authority);

		await request(fixture.app).get("/routine-1").expect(status, { error: code }).expect("cache-control", "no-store");
		expect(fixture.warn).not.toHaveBeenCalled();
	});

	it("sanitizes unexpected failures and refuses a stored firing reason outside the public enum", async function _Unexpected()
	{
		const dependency = _Authority();
		vi.mocked(dependency.read).mockRejectedValue(new Error("ciphertext and database detail"));
		const dependencyFixture = _App(dependency);
		await request(dependencyFixture.app).get("/routine-1").expect(503, { error: "routine_service_unavailable" });

		const reason = _Authority();
		vi.mocked(reason.runNow).mockResolvedValue({ outcome: RoutineCommandOutcome.Refused, firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Refused, conversationId: "conversation-1", scheduledSlot: null, reason: "toString" });
		const reasonFixture = _App(reason);
		await request(reasonFixture.app).post("/routine-1/run-now").send({ expectedLifecycleRevision: 3, idempotencyKey: "run-1" }).expect(503, { error: "routine_service_unavailable" });

		expect(JSON.stringify(dependencyFixture.warn.mock.calls)).not.toContain("ciphertext and database detail");
		expect(JSON.stringify(reasonFixture.warn.mock.calls)).not.toContain("toString");
	});

	it("returns the closed public reason for a refused manual firing", async function _RefusalReason()
	{
		const authority = _Authority();
		vi.mocked(authority.runNow).mockResolvedValue({ outcome: RoutineCommandOutcome.Refused, firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Refused, conversationId: "conversation-1", scheduledSlot: null, reason: RoutineFiringReasons.RoutineRetired });
		const fixture = _App(authority);

		const response = await request(fixture.app).post("/routine-1/run-now").send({ expectedLifecycleRevision: 3, idempotencyKey: "run-1" }).expect(200);
		expect(response.body.firing.reason).toBe(RoutineFiringReasons.RoutineRetired);
	});
});
