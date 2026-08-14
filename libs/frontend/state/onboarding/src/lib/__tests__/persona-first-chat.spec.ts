import { Injector, runInInjectionContext } from "@angular/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import { OpenCranePersonaFirstChatGateway } from "../opencrane-persona-first-chat.gateway";
import { PersonaFirstChatService } from "../persona-first-chat.service";
import { PERSONA_FIRST_CHAT_GATEWAY, PersonaFirstChatConflictError, type PersonaFirstChatGateway } from "../persona-first-chat.types";
import { _ParseUserOnboardingRouteSnapshot } from "../persona-first-chat.validator";

/** Build one valid started first-chat projection for state, adapter, and service tests. */
function _Snapshot(overrides: Partial<PersonaFirstChatSnapshot> = {}): PersonaFirstChatSnapshot
{
	return {
		workflowVersion: 1,
		state: UserOnboardingRouteStates.BootstrapChatInProgress,
		conversationId: "conversation-1",
		persona: { revisionId: "persona-revision-1", displayName: "The Commander", archetype: PersonaFirstChatArchetypes.Commander, primaryColour: PersonaFirstChatColours.Red },
		contentRevision: { id: "commander-v1", digest: `sha256:${"a".repeat(64)}`, sourceLabel: "The Commander bootstrap" },
		transcript: [
			{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: "Welcome.", questionOrdinal: null },
			{ ordinal: 2, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "What are you working on?", questionOrdinal: 1 }
		],
		currentQuestion: { ordinal: 1, text: "What are you working on?" },
		answerCount: 0,
		questionCount: 3,
		canConclude: false,
		startedAt: "2026-08-08T10:00:00.000Z",
		completedAt: null,
		...overrides
	};
}

/** Create the generated-client adapter around mocked request methods. */
function _Adapter(get: ReturnType<typeof vi.fn>, post: ReturnType<typeof vi.fn>): OpenCranePersonaFirstChatGateway
{
	const api = { client: { GET: get, POST: post } } as unknown as ControlPlaneApiService;
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: api }] });
	return runInInjectionContext(injector, function _CreateAdapter() { return new OpenCranePersonaFirstChatGateway(); });
}

describe("persona first-chat response validation", function _PersonaFirstChatValidationSuite()
{
	it("validates the public route projection used after persona approval", function _RouteProjection()
	{
		const route = _ParseUserOnboardingRouteSnapshot({ workflowVersion: 1, state: "bootstrap_chat_pending", personaInterviewId: "interview-1", personaRevisionId: "revision-1", bootstrapConversationId: null, startedAt: "2026-08-08T09:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", completedAt: null });
		expect(route.state).toBe(UserOnboardingRouteStates.BootstrapChatPending);
	});
});

describe("OpenCranePersonaFirstChatGateway", function _OpenCranePersonaFirstChatGatewaySuite()
{
	it("uses only generated first-chat paths and the exact answer body", async function _GeneratedPaths()
	{
		const get = vi.fn().mockResolvedValue({ data: _Snapshot() });
		const post = vi.fn().mockResolvedValue({ data: _Snapshot() });
		const adapter = _Adapter(get, post);

		await adapter.load();
		await adapter.start();
		await adapter.answer({ expectedConversationId: "conversation-1", expectedQuestionOrdinal: 1, text: "  Keep this text  ", idempotencyKey: "retry-key-1" });
		await adapter.conclude();

		expect(get).toHaveBeenCalledWith("/me/onboarding/chat");
		expect(post).toHaveBeenNthCalledWith(1, "/me/onboarding/chat/start");
		expect(post).toHaveBeenNthCalledWith(2, "/me/onboarding/chat/answers", { body: { expectedConversationId: "conversation-1", expectedQuestionOrdinal: 1, text: "  Keep this text  ", idempotencyKey: "retry-key-1" } });
		expect(post).toHaveBeenNthCalledWith(3, "/me/onboarding/chat/conclude");
	});

	it("preserves the authoritative projection from a documented answer conflict", async function _AnswerConflict()
	{
		const advanced = _Snapshot({
			answerCount: 1,
			currentQuestion: { ordinal: 2, text: "What wastes time?" },
			transcript: [
				..._Snapshot().transcript,
				{ ordinal: 3, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, text: "Saved elsewhere.", questionOrdinal: 1 },
				{ ordinal: 4, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: "What wastes time?", questionOrdinal: 2 }
			]
		});
		const post = vi.fn().mockResolvedValue({ error: { error: "onboarding_chat_state_conflict", chat: advanced } });
		const adapter = _Adapter(vi.fn(), post);

		const request = adapter.answer({ expectedConversationId: "conversation-1", expectedQuestionOrdinal: 1, text: "Stale answer", idempotencyKey: "retry-key-1" });
		await expect(request).rejects.toMatchObject({ chat: advanced });
		await expect(request).rejects.toBeInstanceOf(PersonaFirstChatConflictError);
	});

	it("loads route state independently and bounds generated-client failures", async function _RouteAndFailure()
	{
		const route = { workflowVersion: 1, state: "bootstrap_chat_pending", personaInterviewId: "interview-1", personaRevisionId: "revision-1", bootstrapConversationId: null, startedAt: "2026-08-08T09:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", completedAt: null };
		const get = vi.fn().mockResolvedValueOnce({ data: route }).mockResolvedValueOnce({ error: { status: 503 } });
		const adapter = _Adapter(get, vi.fn());

		await expect(adapter.loadRouteState()).resolves.toMatchObject({ state: UserOnboardingRouteStates.BootstrapChatPending });
		await expect(adapter.load()).rejects.toThrow("could not be resumed");
		expect(get).toHaveBeenNthCalledWith(1, "/me/onboarding");
	});
});

describe("PersonaFirstChatService", function _PersonaFirstChatServiceSuite()
{
	/** Mocked narrow first-chat gateway. */
	let gateway: PersonaFirstChatGateway;

	/** Service under test. */
	let service: PersonaFirstChatService;

	beforeEach(function _Configure()
	{
		gateway = { loadRouteState: vi.fn(), load: vi.fn(), start: vi.fn(), answer: vi.fn(), conclude: vi.fn() };
		const injector = Injector.create({ providers: [{ provide: PERSONA_FIRST_CHAT_GATEWAY, useValue: gateway }] });
		service = runInInjectionContext(injector, function _CreateService() { return new PersonaFirstChatService(); });
	});

	it("starts only from the durable pending projection", async function _StartBoundary()
	{
		const pending = _Snapshot({ state: UserOnboardingRouteStates.BootstrapChatPending, conversationId: null, transcript: [], currentQuestion: null, answerCount: 0, startedAt: null });
		const started = _Snapshot();
		vi.mocked(gateway.start).mockResolvedValue(started);

		await expect(service.start(pending)).resolves.toBe(started);
		expect(function _StartAgain() { service.start(started); }).toThrow("not ready to start");
		expect(gateway.start).toHaveBeenCalledTimes(1);
	});

	it("preserves answer text and idempotency key and refuses premature conclusion", async function _MutationBoundary()
	{
		const current = _Snapshot();
		vi.mocked(gateway.answer).mockResolvedValue(current);

		const command = { expectedConversationId: "conversation-1", expectedQuestionOrdinal: 1, text: "answer", idempotencyKey: "retry-key-1" };
		await service.answer(command);
		expect(gateway.answer).toHaveBeenCalledWith(command);
		await expect(service.conclude(current)).rejects.toThrow("not ready");
		expect(gateway.conclude).not.toHaveBeenCalled();
	});

	it("delegates conclusion only from complete server-confirmed evidence", async function _Conclude()
	{
		const ready = _Snapshot({ answerCount: 3, currentQuestion: null, canConclude: true });
		const completed = _Snapshot({ state: UserOnboardingRouteStates.Completed, answerCount: 3, currentQuestion: null, canConclude: false, completedAt: "2026-08-08T11:00:00.000Z" });
		vi.mocked(gateway.conclude).mockResolvedValue(completed);

		await expect(service.conclude(ready)).resolves.toBe(completed);
		expect(gateway.conclude).toHaveBeenCalledTimes(1);
	});
});
