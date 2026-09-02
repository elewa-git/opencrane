import { describe, expect, it, vi } from "vitest";

import { ConversationModes } from "@opencrane/models/conversations";

import { HistoryAnchoredConversationCreationService } from "../conversation-creation-authority";
import { ConversationWriteDenialReasons } from "../types/conversation-authority-result.types";

/** Fixed session coordinates for every creation authority test. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "user-1", issuer: "https://issuer.test" };

/** Builds the authority with a programmable compiler, binding resolver, and history factory. */
function _Authority(overrides: { readonly compiled?: { readonly participantUserIds: readonly string[]; readonly agentServiceId: string | null } | null; readonly binding?: { readonly outcome: "bound"; readonly value: { readonly agentServiceId: string; readonly agentRevisionId: string; readonly agentIdentityId: string; readonly profileRevisionId: string } } | { readonly outcome: "denied"; readonly reason: "service_unavailable" }; readonly historyResult?: { readonly outcome: "projection_needed"; readonly reservation: { readonly conversationId: string } } | { readonly outcome: "projected"; readonly reservation: { readonly conversationId: string } } | { readonly outcome: "denied" } | { readonly outcome: "idempotency_conflict" }; readonly recovered?: { readonly outcome: "projection_needed"; readonly reservation: { readonly conversationId: string } } | { readonly outcome: "projected"; readonly reservation: { readonly conversationId: string } } | { readonly outcome: "denied" } | { readonly outcome: "idempotency_conflict" } | null } = {})
{
	const create = vi.fn().mockResolvedValue(overrides.historyResult ?? { outcome: "projection_needed", reservation: { conversationId: "conversation-1" } });
	const resume = vi.fn().mockResolvedValue(overrides.recovered ?? null);
	const compile = vi.fn().mockResolvedValue(overrides.compiled ?? { participantUserIds: ["user-1", "user-2"], agentServiceId: null });
	const bind = vi.fn().mockResolvedValue(overrides.binding ?? { outcome: "bound", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" } });
	const ensure = vi.fn().mockResolvedValue(undefined);
	return { subject: new HistoryAnchoredConversationCreationService({ compiler: { compile }, agentBindings: { bind }, history: { create: vi.fn().mockReturnValue({ create, resume }) }, computers: { ensure }, clock: { now: function _Now() { return new Date("2026-09-02T00:00:00.000Z"); } } }), create, resume, compile, bind, ensure };
}

describe("HistoryAnchoredConversationCreationService", function _Suite()
{
	it("anchors and projects server-resolved direct participants", async function _CreatesDirect()
	{
		const authority = _Authority();
		await expect(authority.subject.create(_CALLER, { requestId: "00000000-0000-4000-8000-000000000001", mode: ConversationModes.Direct, participantRefs: ["member-2"] })).resolves.toEqual({ outcome: "created", conversationId: "conversation-1" });
		expect(authority.create).toHaveBeenCalledWith(expect.objectContaining({ reservation: expect.objectContaining({ mode: ConversationModes.Direct, participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" }, { userId: "user-2", visibleFromPosition: "2", joinedAt: "2026-09-02T00:00:00.000Z" }], agent: null, agentBinding: null }) }));
	});

	it("denies an Agent session before history when its frozen binding is unavailable", async function _DeniesUnavailableAgent()
	{
		const authority = _Authority({ compiled: { participantUserIds: ["user-1"], agentServiceId: "service-1" }, binding: { outcome: "denied", reason: "service_unavailable" } });
		await expect(authority.subject.create(_CALLER, { requestId: "00000000-0000-4000-8000-000000000002", mode: ConversationModes.AgentSession, personalAgentRef: "service-1" })).resolves.toEqual({ outcome: "denied", reason: ConversationWriteDenialReasons.AgentServiceUnavailable });
		expect(authority.create).not.toHaveBeenCalled();
	});

	it("establishes an Agent computer from the frozen reservation after its conversation anchor", async function _CreatesAgentComputer()
	{
		const authority = _Authority({ compiled: { participantUserIds: ["user-1"], agentServiceId: "service-1" }, historyResult: { outcome: "projection_needed", reservation: { conversationId: "conversation-1", mode: ConversationModes.AgentSession } } as never });
		await authority.subject.create(_CALLER, { requestId: "00000000-0000-4000-8000-000000000005", mode: ConversationModes.AgentSession, personalAgentRef: "service-1" });
		expect(authority.ensure).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation-1" }));
	});

	it("returns the existing idempotency-conflict denial without pretending the anchor was created", async function _ReportsConflict()
	{
		const authority = _Authority({ historyResult: { outcome: "idempotency_conflict" } });
		await expect(authority.subject.create(_CALLER, { requestId: "00000000-0000-4000-8000-000000000003", mode: ConversationModes.Direct, participantRefs: ["member-2"] })).resolves.toEqual({ outcome: "denied", reason: ConversationWriteDenialReasons.IdempotencyConflict });
	});

	it("resumes an anchored request before mutable participant or Agent facts are compiled again", async function _ResumesBeforeCompilation()
	{
		const authority = _Authority({ compiled: null, recovered: { outcome: "projection_needed", reservation: { conversationId: "conversation-recovered" } } });
		await expect(authority.subject.create(_CALLER, { requestId: "00000000-0000-4000-8000-000000000004", mode: ConversationModes.AgentSession, personalAgentRef: "service-removed" })).resolves.toEqual({ outcome: "created", conversationId: "conversation-recovered" });
		expect(authority.resume).toHaveBeenCalledOnce();
		expect(authority.compile).not.toHaveBeenCalled();
		expect(authority.bind).not.toHaveBeenCalled();
		expect(authority.create).not.toHaveBeenCalled();
	});
});
