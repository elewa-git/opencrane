import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, RoutineStatus, type RoutineDetails, type RoutineGateway } from "@opencrane/state/routines";

import { RoutineCommandStates, RoutineControlActions, RoutineReadStates, RoutineSubmitOutcomes } from "../routine-presentation.types";
import { RoutineCommandAdmission } from "../state/routine-command-admission";
import { RoutineControlStore } from "../state/routine-control.store";
import { RoutineDetailScreenStore } from "../state/routine-detail-screen.store";
import { RoutineDetailStore } from "../state/routine-detail.store";
import { RoutineEditorStore } from "../state/routine-editor.store";
import { RoutineHistoryStore } from "../state/routine-history.store";

const _DETAIL: RoutineDetails = { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, ownership: "owner", destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "0 9 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, nextAutomaticOccurrence: "2026-09-28T09:00:00.000Z", lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-self"], audienceChoices: [{ participantRef: "participant-self", displayName: "You", isSelf: true }], instruction: "Review the conversation." };

describe("RoutineDetailScreenStore", function _suite()
{
	beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
	afterEach(function _Reset() { TestBed.resetTestingModule(); });

	it("keeps a committed lifecycle summary when its follow-up read fails and blocks another action", async function _CommittedRefreshFailure()
	{
		const read = vi.fn().mockResolvedValueOnce(_DETAIL).mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable));
		const pause = vi.fn().mockResolvedValue({ routineId: _DETAIL.routineId, currentRevision: 2, status: RoutineStatus.Paused, lifecycleRevision: 4, nextAutomaticOccurrence: null });
		const resume = vi.fn();
		const gateway = _Gateway({ read, firings: vi.fn().mockResolvedValue({ items: [], limit: 20 }), pause, resume });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		await screen.control(RoutineControlActions.Pause);
		expect(screen.detail.authorizedDetail()?.status).toBe(RoutineStatus.Paused);
		expect(screen.detail.authorizedDetail()?.lifecycleRevision).toBe(4);
		expect(screen.controls.state()).toBe(RoutineCommandStates.CommittedRefreshFailed);
		expect((await screen.controls.execute(RoutineControlActions.Resume, screen.detail.authorizedDetail()!)).outcome).toBe(RoutineSubmitOutcomes.Rejected);
		expect(resume).not.toHaveBeenCalled();
	});

	it("purges details, history, and editor state when the route target becomes invalid", async function _InvalidTarget()
	{
		const gateway = _Gateway({ read: vi.fn().mockResolvedValue(_DETAIL), firings: vi.fn().mockResolvedValue({ items: [], limit: 20 }) });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		screen.revise();
		expect(screen.editor.draft().instruction).toBe(_DETAIL.instruction);
		screen.start(null);
		expect(screen.detail.authorizedDetail()).toBeNull();
		expect(screen.history.rows()).toEqual([]);
		expect(screen.editor.draft().instruction).toBe("");
	});

	it("does not apply an old command continuation after the route selects another routine", async function _TargetFence()
	{
		const delayedRefresh = _Deferred<RoutineDetails>();
		const second = { ..._DETAIL, routineId: "routine-2", instruction: "Second routine." };
		const read = vi.fn().mockResolvedValueOnce(_DETAIL).mockReturnValueOnce(delayedRefresh.promise).mockResolvedValue(second);
		const gateway = _Gateway({ read, firings: vi.fn().mockResolvedValue({ items: [], limit: 20 }), pause: vi.fn().mockResolvedValue({ routineId: _DETAIL.routineId, currentRevision: 2, status: RoutineStatus.Paused, lifecycleRevision: 4, nextAutomaticOccurrence: null }) });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		const pending = screen.control(RoutineControlActions.Pause);
		await _Settled();
		screen.start(second.routineId);
		delayedRefresh.resolve(_DETAIL);
		await pending;
		await _Settled();
		expect(screen.detail.authorizedDetail()?.routineId).toBe(second.routineId);
		expect(screen.controls.state()).toBe(RoutineCommandStates.Idle);
		expect(screen.controls.error()).toBeNull();
	});

	it("purges every sibling store when a control command loses current access", async function _ControlAccessLoss()
	{
		const historyItem = { firingId: "firing-1", routineRevision: 2, trigger: "manual" as const, disposition: "completed" as const, scheduledSlot: null, createdAt: "2026-09-27T09:00:00.000Z", finishedAt: "2026-09-27T09:01:00.000Z", reason: null, runTerminalReason: "success" as const, resultConversationId: null, actualCost: null };
		const gateway = _Gateway({ read: vi.fn().mockResolvedValue(_DETAIL), firings: vi.fn().mockResolvedValue({ items: [historyItem], limit: 20 }), pause: vi.fn().mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.AccessDenied)) });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		screen.revise();
		expect(screen.history.rows()).toHaveLength(1);
		await screen.control(RoutineControlActions.Pause);
		expect(screen.detail.authorizedDetail()).toBeNull();
		expect(screen.history.rows()).toEqual([]);
		expect(screen.editor.draft().instruction).toBe("");
	});

	it("purges the new session when its history access is denied after an earlier session loss", async function _NewSessionAccessLoss()
	{
		const session = signal<string | null>("session-a");
		const firings = vi.fn().mockResolvedValueOnce({ items: [], limit: 20 }).mockRejectedValueOnce(new RoutineGatewayError(RoutineGatewayErrorKinds.AccessDenied));
		const gateway = _Gateway({ read: vi.fn().mockResolvedValue(_DETAIL), firings, pause: vi.fn().mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.AccessDenied)) });
		const screen = _Screen(gateway, session);
		screen.start(_DETAIL.routineId);
		await _Settled();
		await screen.control(RoutineControlActions.Pause);
		session.set("session-b");
		TestBed.tick();
		await _Settled();
		TestBed.tick();
		expect(firings).toHaveBeenCalledTimes(2);
		expect(screen.detail.authorizedDetail()).toBeNull();
		expect(screen.detail.state()).toBe(RoutineReadStates.AccessChanged);
		expect(screen.history.rows()).toEqual([]);
		expect(screen.history.state()).toBe(RoutineReadStates.AccessChanged);
	});

	it("hides stale definition fields when a committed revision cannot be reread", async function _RevisionRefreshFailure()
	{
		const read = vi.fn().mockResolvedValueOnce(_DETAIL).mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable));
		const revise = vi.fn().mockResolvedValue({ routineId: _DETAIL.routineId, currentRevision: 3, status: RoutineStatus.Active, lifecycleRevision: 3, nextAutomaticOccurrence: _DETAIL.nextAutomaticOccurrence });
		const gateway = _Gateway({ read, firings: vi.fn().mockResolvedValue({ items: [], limit: 20 }), preview: vi.fn().mockResolvedValue({ schedule: _DETAIL.schedule, calculatedAt: "2026-09-27T09:00:00.000Z", nextOccurrences: ["2026-09-28T09:00:00.000Z", "2026-09-29T09:00:00.000Z", "2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z"] }), revise });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		screen.revise();
		screen.editor.setInstruction("Replacement instruction.");
		await screen.editor.requestPreview();
		await screen.submitRevision();
		expect(screen.detail.authorizedDetail()).toBeNull();
		expect(screen.detail.state()).toBe(RoutineReadStates.CommittedRefreshFailed);
		expect(screen.detail.error()).toContain("revision completed");
	});

	it("retries only the exact control action retained after an uncertain outcome", async function _ExactControlRetry()
	{
		const pause = vi.fn();
		const runNow = vi.fn().mockRejectedValueOnce(new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable)).mockResolvedValue({ firingId: "firing-1", routineId: _DETAIL.routineId, routineRevision: 2, trigger: "manual", disposition: "preparing", scheduledSlot: null, reason: null });
		const gateway = _Gateway({ read: vi.fn().mockResolvedValue(_DETAIL), firings: vi.fn().mockResolvedValue({ items: [], limit: 20 }), pause, runNow });
		const screen = _Screen(gateway);
		screen.start(_DETAIL.routineId);
		await _Settled();
		await screen.control(RoutineControlActions.RunNow);
		expect(screen.controls.retryAction()).toBe(RoutineControlActions.RunNow);
		await screen.control(RoutineControlActions.Pause);
		expect(pause).not.toHaveBeenCalled();
		await screen.control(RoutineControlActions.RunNow);
		expect(runNow).toHaveBeenCalledTimes(2);
		expect(runNow.mock.calls[1]?.[1]).toEqual(runNow.mock.calls[0]?.[1]);
	});
});

function _Screen(gateway: RoutineGateway, session = signal<string | null>("session-1")): RoutineDetailScreenStore
{
	TestBed.configureTestingModule({ providers: [RoutineCommandAdmission, RoutineControlStore, RoutineDetailScreenStore, RoutineDetailStore, RoutineEditorStore, RoutineHistoryStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
	return TestBed.inject(RoutineDetailScreenStore);
}

function _Gateway(overrides: Partial<RoutineGateway>): RoutineGateway
{
	const unavailable = vi.fn().mockRejectedValue(new Error("Unexpected gateway call"));
	return { list: unavailable, read: unavailable, firings: unavailable, creationOptions: unavailable, proposal: unavailable, cancelProposal: unavailable, preview: unavailable, create: unavailable, revise: unavailable, pause: unavailable, resume: unavailable, retire: unavailable, runNow: unavailable, ...overrides };
}

async function _Settled(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

function _Deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void }
{
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
	return { promise, resolve(value: T): void { resolvePromise?.(value); } };
}
