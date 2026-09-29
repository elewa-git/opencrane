import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RoutineProposalStates } from "@opencrane/contracts";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, RoutineGatewayError, RoutineGatewayErrorKinds, RoutineStatus, type RoutineDetails, type RoutineGateway } from "@opencrane/state/routines";

import { RoutineControlActions, RoutineSubmitOutcomes } from "../routine-presentation.types";
import { RoutineCommandAdmission } from "../state/routine-command-admission";
import { RoutineControlStore } from "../state/routine-control.store";
import { RoutineEditorStore } from "../state/routine-editor.store";

const _DETAIL: RoutineDetails = { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, ownership: "owner", destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "0 9 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, nextAutomaticOccurrence: "2026-09-28T09:00:00.000Z", lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-self"], audienceChoices: [{ participantRef: "participant-self", displayName: "You", isSelf: true }], instruction: "Review the conversation." };
const _OPTIONS = { destinationConversationId: "conversation-1", audienceChoices: [{ participantRef: "participant-self", displayName: "You", isSelf: true }], managedServiceChoices: [{ managedServiceId: "service-1", displayName: "Research" }] };
const _PREVIEW = { schedule: _DETAIL.schedule, calculatedAt: "2026-09-27T09:00:00.000Z", nextOccurrences: ["2026-09-28T09:00:00.000Z", "2026-09-29T09:00:00.000Z", "2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z"] as const };
const _PROPOSAL = { proposalRef: "proposal-1", sourceConversationId: "authorized-conversation", suggestion: { instruction: "Review the weekly sales.", schedule: { expression: "0 9 * * 1", timezone: "UTC" } }, expiresAt: "2026-09-29T12:00:00.000Z", state: RoutineProposalStates.Pending } as const;

describe("RoutineEditorStore", function _suite()
{
	beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
	afterEach(function _reset() { TestBed.resetTestingModule(); });

	it("rejects a preview that completed after the schedule changed", async function _stalePreview()
	{
		const preview = _Deferred<typeof _PREVIEW>();
		const gateway = _Gateway({ creationOptions: vi.fn().mockResolvedValue(_OPTIONS), preview: vi.fn().mockReturnValue(preview.promise) });
		const store = _Store(gateway);
		store.startCreate("conversation-1");
		await _Settled();
		store.setManagedService("service-1");
		store.setInstruction("Prepare a digest.");
		store.setTimezone("UTC");
		const pending = store.requestPreview();
		store.setTimezone("Europe/Brussels");
		preview.resolve(_PREVIEW);
		await pending;
		expect(store.draft().timezone).toBe("Europe/Brussels");
		expect(store.preview()).toBeNull();
	});

	it("keeps an uncertain create command and freezes its payload until an explicit retry", async function _uncertainCreate()
	{
		const create = vi.fn().mockRejectedValueOnce(new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidResponse)).mockResolvedValue({ routineId: "routine-1", currentRevision: 1, status: RoutineStatus.Active, lifecycleRevision: 1, nextAutomaticOccurrence: null });
		const gateway = _Gateway({ creationOptions: vi.fn().mockResolvedValue(_OPTIONS), preview: vi.fn().mockResolvedValue(_PREVIEW), create });
		const store = _Store(gateway);
		store.startCreate("conversation-1");
		await _Settled();
		store.setManagedService("service-1");
		store.setInstruction("Prepare a digest.");
		store.setTimezone("UTC");
		await store.requestPreview();
		const first = await store.submitCreate();
		const saved = create.mock.calls[0]?.[0];
		store.setInstruction("Changed after uncertainty.");
		const second = await store.submitCreate();
		expect(first.outcome).toBe(RoutineSubmitOutcomes.Uncertain);
		expect(store.draft().instruction).toBe("Prepare a digest.");
		expect(second.outcome).toBe(RoutineSubmitOutcomes.Committed);
		expect(create.mock.calls[1]?.[0]).toEqual(saved);
	});

	it("keeps the captured request signature when the server displays a normalized schedule", async function _NormalizedPreview()
	{
		const normalized = { ..._PREVIEW, schedule: { expression: "0 9 * * *", timezone: "Etc/UTC" } };
		const gateway = _Gateway({ creationOptions: vi.fn().mockResolvedValue(_OPTIONS), preview: vi.fn().mockResolvedValue(normalized) });
		const store = _Store(gateway);
		store.startCreate("conversation-1");
		await _Settled();
		store.setManagedService("service-1");
		store.setInstruction("Prepare a digest.");
		store.setTimezone("UTC");
		await store.requestPreview();
		expect(store.preview()?.scheduleLabel).toBe("0 9 * * * · Etc/UTC");
		expect(store.previewStale()).toBe(false);
		expect(store.canSubmit()).toBe(true);
	});

	it("does not clear a newer preview's loading state when an aborted preview settles", async function _PreviewLoadingOwner()
	{
		const first = _Deferred<typeof _PREVIEW>();
		const second = _Deferred<typeof _PREVIEW>();
		const gateway = _Gateway({ creationOptions: vi.fn().mockResolvedValue(_OPTIONS), preview: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
		const store = _Store(gateway);
		store.startCreate("conversation-1");
		await _Settled();
		store.setTimezone("UTC");
		const obsolete = store.requestPreview();
		store.setTimezone("Europe/Brussels");
		const current = store.requestPreview();
		first.resolve(_PREVIEW);
		await obsolete;
		expect(store.previewLoading()).toBe(true);
		second.resolve(_PREVIEW);
		await current;
		expect(store.previewLoading()).toBe(false);
	});

	it("preserves a human revision draft across conflict refresh", async function _conflictDraft()
	{
		const gateway = _Gateway({ preview: vi.fn().mockResolvedValue(_PREVIEW), revise: vi.fn().mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.Conflict)) });
		const store = _Store(gateway);
		store.startRevision(_DETAIL);
		store.setInstruction("Human edit retained.");
		await store.requestPreview();
		expect((await store.submitRevision()).outcome).toBe(RoutineSubmitOutcomes.Conflict);
		expect(store.canSubmit()).toBe(false);
		store.acceptRefreshedRevision({ ..._DETAIL, currentRevision: 3, lifecycleRevision: 4, instruction: "Server edit." });
		expect(store.draft().instruction).toBe("Human edit retained.");
		expect(store.canSubmit()).toBe(true);
	});

	it("blocks lifecycle controls while a revision outcome is uncertain", async function _sharedAdmission()
	{
		const pause = vi.fn();
		const gateway = _Gateway({ preview: vi.fn().mockResolvedValue(_PREVIEW), revise: vi.fn().mockRejectedValue(new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable)), pause });
		const session = signal<string | null>("session-1");
		TestBed.configureTestingModule({ providers: [RoutineCommandAdmission, RoutineControlStore, RoutineEditorStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
		const editor = TestBed.inject(RoutineEditorStore);
		const controls = TestBed.inject(RoutineControlStore);
		editor.startRevision(_DETAIL);
		controls.start(_DETAIL.routineId);
		await editor.requestPreview();
		expect((await editor.submitRevision()).outcome).toBe(RoutineSubmitOutcomes.Uncertain);
		expect((await controls.execute(RoutineControlActions.Pause, _DETAIL)).outcome).toBe(RoutineSubmitOutcomes.Rejected);
		expect(pause).not.toHaveBeenCalled();
	});

	it("seeds only pending proposal values and uses its authorized source conversation", async function _PendingProposal()
	{
		const proposal = vi.fn().mockResolvedValue(_PROPOSAL);
		const gateway = _Gateway({ proposal, creationOptions: vi.fn().mockResolvedValue({ ..._OPTIONS, destinationConversationId: "authorized-conversation" }) });
		const store = _Store(gateway);
		store.startCreate("conflicting-query-conversation", "proposal-1");
		await _Settled();
		expect(proposal).toHaveBeenCalledWith("proposal-1", expect.any(AbortSignal));
		expect(store.destinationConversationId()).toBe("authorized-conversation");
		expect(store.draft()).toMatchObject({ instruction: "Review the weekly sales.", expression: "0 9 * * 1", timezone: "UTC" });
	});

	it("keeps the proposal reference in the reviewed create command and reuses it on uncertain retry", async function _ProposalCreateRetry()
	{
		const create = vi.fn().mockRejectedValueOnce(new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable)).mockResolvedValue({ routineId: "routine-1" });
		const gateway = _Gateway({ proposal: vi.fn().mockResolvedValue(_PROPOSAL), creationOptions: vi.fn().mockResolvedValue(_OPTIONS), preview: vi.fn().mockResolvedValue(_PREVIEW), create });
		const store = _Store(gateway);
		store.startCreate("authorized-conversation", "proposal-1");
		await _Settled();
		store.setManagedService("service-1");
		await store.requestPreview();
		expect((await store.submitCreate()).outcome).toBe(RoutineSubmitOutcomes.Uncertain);
		expect((await store.submitCreate()).outcome).toBe(RoutineSubmitOutcomes.Committed);
		expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
		expect(create.mock.calls[0]?.[0]).toMatchObject({ proposalRef: "proposal-1", destinationConversationId: "authorized-conversation" });
	});

	it("does not seed a terminal proposal", async function _TerminalProposal()
	{
		const proposal = vi.fn().mockResolvedValue({ ..._PROPOSAL, state: RoutineProposalStates.Accepted, acceptedRoutineId: "routine-accepted" });
		const terminal = _Store(_Gateway({ proposal, creationOptions: vi.fn().mockResolvedValue(_OPTIONS) }));
		terminal.startCreate("conversation-1", "proposal-1");
		await _Settled();
		expect(terminal.acceptedRoutineId()).toBe("routine-accepted");
		expect(terminal.draft().instruction).toBe("");
	});

	it("cancels a pending proposal only once", async function _CancelProposal()
	{
		const response = _Deferred<typeof _PROPOSAL>();
		const cancel = vi.fn().mockReturnValue(response.promise);
		const pending = _Store(_Gateway({ proposal: vi.fn().mockResolvedValue(_PROPOSAL), creationOptions: vi.fn().mockResolvedValue(_OPTIONS), cancelProposal: cancel }));
		pending.startCreate("conversation-1", "proposal-1");
		await _Settled();
		const first = pending.cancelProposal();
		const second = pending.cancelProposal();
		expect(cancel).toHaveBeenCalledTimes(1);
		response.resolve({ ..._PROPOSAL, state: RoutineProposalStates.Cancelled });
		expect(await first).toBe(true);
		expect(await second).toBe(false);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("adopts an accepted cancellation winner and its routine link", async function _AcceptedCancellation()
	{
		const response = _Deferred<typeof _PROPOSAL & { readonly state: RoutineProposalStates.Accepted; readonly acceptedRoutineId: string }>();
		const cancel = vi.fn().mockReturnValue(response.promise);
		const accepted = _Store(_Gateway({ proposal: vi.fn().mockResolvedValue(_PROPOSAL), creationOptions: vi.fn().mockResolvedValue(_OPTIONS), cancelProposal: cancel }));
		accepted.startCreate("conversation-1", "proposal-1");
		await _Settled();
		const cancellation = accepted.cancelProposal();
		response.resolve({ ..._PROPOSAL, state: RoutineProposalStates.Accepted, acceptedRoutineId: "routine-accepted" });
		expect(await cancellation).toBe(false);
		expect(accepted.proposalState()).toBe(RoutineProposalStates.Accepted);
		expect(accepted.acceptedRoutineId()).toBe("routine-accepted");
	});

	it("keeps a newer cancellation busy when an obsolete cancellation settles", async function _CancellationOwner()
	{
		const obsoleteResponse = _Deferred<typeof _PROPOSAL>();
		const currentResponse = _Deferred<typeof _PROPOSAL>();
		const cancel = vi.fn().mockReturnValueOnce(obsoleteResponse.promise).mockReturnValueOnce(currentResponse.promise);
		const proposal = vi.fn().mockResolvedValueOnce(_PROPOSAL).mockResolvedValueOnce({ ..._PROPOSAL, proposalRef: "proposal-2", sourceConversationId: "conversation-2" });
		const rebound = _Store(_Gateway({ proposal, creationOptions: vi.fn().mockResolvedValue(_OPTIONS), cancelProposal: cancel }));
		rebound.startCreate("conversation-1", "proposal-1");
		await _Settled();
		const obsolete = rebound.cancelProposal();
		rebound.startCreate("conversation-2", "proposal-2");
		await _Settled();
		const current = rebound.cancelProposal();
		obsoleteResponse.resolve({ ..._PROPOSAL, state: RoutineProposalStates.Cancelled });
		expect(await obsolete).toBe(false);
		expect(cancel).toHaveBeenCalledTimes(2);
		expect(rebound.proposalCanceling()).toBe(true);
		expect(await rebound.cancelProposal()).toBe(false);
		expect(cancel).toHaveBeenCalledTimes(2);
		expect(rebound.proposalState()).toBe(RoutineProposalStates.Pending);
		currentResponse.resolve({ ..._PROPOSAL, proposalRef: "proposal-2", state: RoutineProposalStates.Cancelled });
		expect(await current).toBe(true);
		expect(rebound.proposalCanceling()).toBe(false);
		expect(cancel).toHaveBeenCalledTimes(2);
	});
});

function _Store(gateway: RoutineGateway): RoutineEditorStore
{
	const session = signal<string | null>("session-1");
	TestBed.configureTestingModule({ providers: [RoutineCommandAdmission, RoutineEditorStore, { provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: session }] });
	return TestBed.inject(RoutineEditorStore);
}

function _Gateway(overrides: Partial<RoutineGateway>): RoutineGateway
{
	const unavailable = vi.fn().mockRejectedValue(new Error("Unexpected gateway call"));
	return { list: unavailable, read: unavailable, firings: unavailable, creationOptions: unavailable, proposal: unavailable, cancelProposal: unavailable, preview: unavailable, create: unavailable, revise: unavailable, pause: unavailable, resume: unavailable, retire: unavailable, runNow: unavailable, ...overrides };
}

function _Deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void }
{
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
	return { promise, resolve(value: T): void { resolvePromise?.(value); } };
}

async function _Settled(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
