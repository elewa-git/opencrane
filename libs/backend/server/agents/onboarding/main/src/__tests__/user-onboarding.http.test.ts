import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/backend/observability";

import { __CreateUserOnboardingRouter } from "../user-onboarding.http.js";
import { UserOnboardingAnswerStatuses, UserOnboardingStates } from "../user-onboarding.enums.js";
import type { __UserOnboardingChatAuthority } from "../user-onboarding-chat-authority.js";
import type { __UserOnboardingAuthority } from "../user-onboarding-authority.js";

describe("__CreateUserOnboardingRouter", function _UserOnboardingRouterSuite()
{
	it("logs an unexpected authority failure with bounded owner context", async function _LogsAuthorityFailure()
	{
		const err = new Error("database unavailable");
		const authority = { readOrCreate: vi.fn().mockRejectedValue(err) } as unknown as __UserOnboardingAuthority;
		const error = vi.fn();
		const logger = { error } as unknown as Logger;
		const app = express();
		app.use("/api/v1/me/onboarding", __CreateUserOnboardingRouter({
			authority,
			chatAuthority: {} as never,
			resolveOwner: function _Owner() { return { siloId: "silo-a", subjectId: "subject-a" }; },
			logger,
		}));

		const response = await request(app).get("/api/v1/me/onboarding");

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "onboarding_authority_unavailable" });
		expect(error).toHaveBeenCalledWith(
			{ err, operation: "user_onboarding.read_or_create", siloId: "silo-a", subjectId: "subject-a" },
			"User onboarding route-state read failed",
		);
	});

	it("returns an authentication denial without calling or logging the authority", async function _DeniesAnonymous()
	{
		const readOrCreate = vi.fn();
		const error = vi.fn();
		const app = express();
		app.use(__CreateUserOnboardingRouter({
			authority: { readOrCreate } as unknown as __UserOnboardingAuthority,
			chatAuthority: {} as never,
			resolveOwner: function _Anonymous() { return null; },
			logger: { error } as unknown as Logger,
		}));

		const response = await request(app).get("/");

		expect(response.status).toBe(401);
		expect(readOrCreate).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("exposes start, bounded answer, conflict, and conclusion through the owner-only chat paths", async function _RoutesGuidedChat()
	{
		const projection = { workflowVersion: 1, state: UserOnboardingStates.BootstrapChatInProgress, conversationId: "conversation-a", persona: null, contentRevision: null, transcript: [], currentQuestion: null, answerCount: 3, questionCount: 3, canConclude: true, startedAt: "2026-08-08T10:00:00.000Z", completedAt: null };
		const start = vi.fn().mockResolvedValue(projection);
		const answer = vi.fn().mockResolvedValueOnce({ status: UserOnboardingAnswerStatuses.Recorded, chat: projection }).mockResolvedValueOnce({ status: UserOnboardingAnswerStatuses.IdempotencyConflict, chat: projection });
		const conclude = vi.fn().mockResolvedValue({ ...projection, state: UserOnboardingStates.Completed });
		const chatAuthority = { start, answer, conclude } as unknown as __UserOnboardingChatAuthority;
		const app = express();
		app.use(express.json());
		app.use("/api/v1/me/onboarding", __CreateUserOnboardingRouter({ authority: {} as never, chatAuthority, resolveOwner: function _Owner() { return { siloId: "silo-a", subjectId: "subject-a" }; }, logger: { error: vi.fn() } as unknown as Logger }));

		await request(app).post("/api/v1/me/onboarding/chat/start").send({}).expect(200);
		const answerBody = { expectedConversationId: "conversation-a", expectedQuestionOrdinal: 3, text: "Answer", idempotencyKey: "key-a" };
		await request(app).post("/api/v1/me/onboarding/chat/answers").send(answerBody).expect(201);
		const conflict = await request(app).post("/api/v1/me/onboarding/chat/answers").send({ ...answerBody, text: "Different" }).expect(409);
		await request(app).post("/api/v1/me/onboarding/chat/answers").send({ ...answerBody, personaRevisionId: "browser-choice" }).expect(400);
		await request(app).post("/api/v1/me/onboarding/chat/conclude").send({}).expect(200);

		expect(start).toHaveBeenCalledWith({ siloId: "silo-a", subjectId: "subject-a" });
		expect(answer).toHaveBeenNthCalledWith(1, { siloId: "silo-a", subjectId: "subject-a" }, answerBody);
		expect(conflict.body).toEqual({ error: "onboarding_chat_idempotency_conflict", chat: projection });
		expect(conclude).toHaveBeenCalledOnce();
	});
});
