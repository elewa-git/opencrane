import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { RoutineGatewayErrorKinds, RoutineFiringDisposition, RoutineFiringTrigger } from "@opencrane/state/routines";

import { OpenCraneRoutineGateway } from "../opencrane-routines.gateway";

beforeAll(function _InitializeAngularTesting(): void
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(function _ResetAngularTesting(): void
{
	TestBed.resetTestingModule();
});

const _routine = { routineId: "routine-1", currentRevision: 2, status: "active" as const, lifecycleRevision: 3, nextAutomaticOccurrence: "2026-09-02T00:00:00.000Z" };
const _detail = { ..._routine, ownership: "owner" as const, destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research assistant" }, schedule: { expression: "0 9 * * 1", timezone: "Africa/Nairobi" }, lastAutomaticOccurrence: null, lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["self"], audienceChoices: [{ participantRef: "self", displayName: "Alex", isSelf: true }], instruction: "Review the latest records." };
const _listItem = { ..._routine, ownership: _detail.ownership, destinationConversationId: _detail.destinationConversationId, selectedManagedService: _detail.selectedManagedService, schedule: _detail.schedule, lastAutomaticOccurrence: null, lastFiring: null, capabilities: _detail.capabilities };
const _firing = { firingId: "firing-1", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, scheduledSlot: null, reason: null };
const _historyItem = { firingId: "firing-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Completed, scheduledSlot: null, createdAt: "2026-09-01T00:00:00.000Z", finishedAt: "2026-09-01T00:01:00.000Z", reason: null, runTerminalReason: "success" as const, resultConversationId: "conversation-2", actualCost: null };

function _Gateway(get: ReturnType<typeof vi.fn>, post: ReturnType<typeof vi.fn>): OpenCraneRoutineGateway
{
	TestBed.configureTestingModule({ providers: [OpenCraneRoutineGateway, { provide: ControlPlaneApiService, useValue: { client: { GET: get, POST: post } } }] });
	return TestBed.inject(OpenCraneRoutineGateway);
}

function _Ok(data: unknown, status = 200): { data: unknown; response: { status: number } }
{
	return { data, response: { status } };
}

describe("OpenCraneRoutineGateway", function _GatewaySuite()
{
	it("serializes every routine operation through the core client", async function _SerializesOperations()
	{
		const get = vi.fn()
			.mockResolvedValueOnce(_Ok({ items: [_listItem], limit: 20 }))
			.mockResolvedValueOnce(_Ok({ routine: _detail }))
			.mockResolvedValueOnce(_Ok({ items: [_historyItem], limit: 20 }))
			.mockResolvedValueOnce(_Ok({ destinationConversationId: "conversation-1", audienceChoices: _detail.audienceChoices, managedServiceChoices: [_detail.selectedManagedService] }));
		const post = vi.fn()
			.mockResolvedValueOnce(_Ok({ schedule: _detail.schedule, calculatedAt: "2026-09-01T00:00:00.000Z", nextOccurrences: ["2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z", "2026-09-04T00:00:00.000Z", "2026-09-05T00:00:00.000Z", "2026-09-06T00:00:00.000Z"] }))
			.mockResolvedValueOnce(_Ok({ routine: _routine }, 201))
			.mockResolvedValueOnce(_Ok({ routine: _routine }))
			.mockResolvedValueOnce(_Ok({ routine: _routine }))
			.mockResolvedValueOnce(_Ok({ routine: _routine }))
			.mockResolvedValueOnce(_Ok({ routine: _routine }))
			.mockResolvedValueOnce(_Ok({ firing: _firing }));
		const gateway = _Gateway(get, post);
		const query = { limit: 20, cursor: "opaque-token" };
		const control = { expectedLifecycleRevision: 3, idempotencyKey: "key-1" };

		await gateway.list(query);
		await gateway.read("routine-1");
		await gateway.firings("routine-1", query);
		await gateway.creationOptions("conversation-1");
		await gateway.preview(_detail.schedule);
		await gateway.create({ destinationConversationId: "conversation-1", audienceParticipantRefs: ["self"], selectedManagedServiceId: "service-1", schedule: _detail.schedule, instruction: "Review the latest records.", idempotencyKey: "key-1" });
		await gateway.revise("routine-1", { expectedRevision: 2, expectedLifecycleRevision: 3, schedule: _detail.schedule, instruction: "Review the latest records.", idempotencyKey: "key-2" });
		await gateway.pause("routine-1", control);
		await gateway.resume("routine-1", control);
		await gateway.retire("routine-1", control);
		await gateway.runNow("routine-1", control);

		expect(get).toHaveBeenNthCalledWith(1, "/me/routines", { params: { query }, signal: undefined });
		expect(get).toHaveBeenNthCalledWith(2, "/me/routines/{routineId}", { params: { path: { routineId: "routine-1" } }, signal: undefined });
		expect(get).toHaveBeenNthCalledWith(3, "/me/routines/{routineId}/firings", { params: { path: { routineId: "routine-1" }, query }, signal: undefined });
		expect(get).toHaveBeenNthCalledWith(4, "/me/routines/creation-options", { params: { query: { destinationConversationId: "conversation-1" } }, signal: undefined });
		expect(post).toHaveBeenNthCalledWith(1, "/me/routines/schedule-preview", expect.objectContaining({ body: { schedule: _detail.schedule } }));
		expect(post).toHaveBeenNthCalledWith(3, "/me/routines/{routineId}/revise", expect.objectContaining({ body: expect.objectContaining({ expectedRevision: 2 }) }));
		expect(post).toHaveBeenNthCalledWith(7, "/me/routines/{routineId}/run-now", expect.objectContaining({ body: control }));
	});

	it.each([[400, RoutineGatewayErrorKinds.InvalidRequest], [401, RoutineGatewayErrorKinds.Unauthenticated], [403, RoutineGatewayErrorKinds.AccessDenied], [404, RoutineGatewayErrorKinds.NotFound], [409, RoutineGatewayErrorKinds.Conflict], [503, RoutineGatewayErrorKinds.Unavailable], [418, RoutineGatewayErrorKinds.Unknown]] as const)("maps status %s without exposing server prose", async function _MapsStatus(status, kind)
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue({ error: { error: "private server detail" }, response: { status } }), vi.fn());
		await expect(gateway.list()).rejects.toMatchObject({ kind });
		await expect(gateway.list()).rejects.not.toThrow("private server detail");
	});

	it("rejects malformed successful responses", async function _RejectsMalformedResponse()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(_Ok({ items: [{ secret: "hidden" }], limit: 20 })), vi.fn());
		await expect(gateway.list()).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
	});

	it("does not invoke the client for a pre-aborted read or mutation", async function _DoesNotStartPreAbortedRequests()
	{
		const get = vi.fn();
		const post = vi.fn();
		const gateway = _Gateway(get, post);
		const controller = new AbortController();
		controller.abort();
		const control = { expectedLifecycleRevision: 3, idempotencyKey: "key-1" };
		const operations = [
			() => gateway.list(undefined, controller.signal),
			() => gateway.read("routine-1", controller.signal),
			() => gateway.firings("routine-1", undefined, controller.signal),
			() => gateway.creationOptions("conversation-1", controller.signal),
			() => gateway.preview(_detail.schedule, controller.signal),
			() => gateway.create({ destinationConversationId: "conversation-1", audienceParticipantRefs: ["self"], selectedManagedServiceId: "service-1", schedule: _detail.schedule, instruction: "Review the latest records.", idempotencyKey: "key-1" }, controller.signal),
			() => gateway.revise("routine-1", { expectedRevision: 2, expectedLifecycleRevision: 3, schedule: _detail.schedule, instruction: "Review the latest records.", idempotencyKey: "key-2" }, controller.signal),
			() => gateway.pause("routine-1", control, controller.signal),
			() => gateway.resume("routine-1", control, controller.signal),
			() => gateway.retire("routine-1", control, controller.signal),
			() => gateway.runNow("routine-1", control, controller.signal),
		];

		for (const operation of operations)
			await expect(operation()).rejects.toMatchObject({ name: "AbortError" });

		expect(get).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});

	it("rejects a successful read bound to another routine", async function _RejectsMismatchedReadIdentity()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(_Ok({ routine: { ..._detail, routineId: "routine-2" } })), vi.fn());

		await expect(gateway.read("routine-1")).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
	});

	it("rejects creation options bound to another destination", async function _RejectsMismatchedCreationOptionsIdentity()
	{
		const gateway = _Gateway(vi.fn().mockResolvedValue(_Ok({ destinationConversationId: "conversation-2", audienceChoices: _detail.audienceChoices, managedServiceChoices: [_detail.selectedManagedService] })), vi.fn());

		await expect(gateway.creationOptions("conversation-1")).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
	});

	it("rejects successful lifecycle definitions bound to another routine", async function _RejectsMismatchedDefinitionIdentity()
	{
		const post = vi.fn().mockResolvedValue(_Ok({ routine: { ..._routine, routineId: "routine-2" } }));
		const gateway = _Gateway(vi.fn(), post);
		const control = { expectedLifecycleRevision: 3, idempotencyKey: "key-1" };

		await expect(gateway.revise("routine-1", { expectedRevision: 2, expectedLifecycleRevision: 3, schedule: _detail.schedule, instruction: "Review the latest records.", idempotencyKey: "key-2" })).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
		await expect(gateway.pause("routine-1", control)).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
		await expect(gateway.resume("routine-1", control)).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
		await expect(gateway.retire("routine-1", control)).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
	});

	it("rejects a successful firing bound to another routine", async function _RejectsMismatchedFiringIdentity()
	{
		const gateway = _Gateway(vi.fn(), vi.fn().mockResolvedValue(_Ok({ firing: { ..._firing, routineId: "routine-2" } })));

		await expect(gateway.runNow("routine-1", { expectedLifecycleRevision: 3, idempotencyKey: "key-1" })).rejects.toMatchObject({ kind: RoutineGatewayErrorKinds.InvalidResponse });
	});

	it("rejects a late response after its read signal is aborted", async function _RejectsLateAbort()
	{
		let resolve: (value: unknown) => void = function _MissingResolve(value: unknown): void { void value; };
		const pending = new Promise(function _Pending(result)
		{
			resolve = result;
		});
		const gateway = _Gateway(vi.fn().mockReturnValue(pending), vi.fn());
		const controller = new AbortController();
		const read = gateway.list(undefined, controller.signal);
		controller.abort();
		resolve(_Ok({ items: [], limit: 20 }));
		await expect(read).rejects.toMatchObject({ name: "AbortError" });
	});
});
