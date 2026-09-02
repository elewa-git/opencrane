import { ConversationCreationReservationState, ConversationMode } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ConversationModes } from "@opencrane/models/conversations";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationCreationReservationRepository } from "../prisma-conversation-creation-reservation-repository";
import { PrismaConversationProductAuthorizationRepository } from "../conversation-product-authorization";

const _SILO_ID = "silo-1";
const _PRINCIPAL_ID = "principal-1";
const _REQUEST_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _CONVERSATION_ID = "31c1f1dc-0011-4f13-9c2f-d3841ffd6651";
const _HISTORY_EVENT_ID = "31c1f1dc-0012-4f13-9c2f-d3841ffd6651";
const _DIGEST = `sha256:${"a".repeat(64)}` as const;
const _EVIDENCE = { decisionEvidenceId: "decision-1", decisionDigest: `sha256:${"b".repeat(64)}` as const, policyRevisionHash: `sha256:${"c".repeat(64)}` as const, effectiveAuthorizationDigest: `sha256:${"d".repeat(64)}` as const };

function _Command(overrides: Record<string, unknown> = {})
{
	return {
		siloId: _SILO_ID,
		principalId: _PRINCIPAL_ID,
		requestId: _REQUEST_ID,
		requestDigest: _DIGEST,
		conversationId: _CONVERSATION_ID,
		historyEventId: _HISTORY_EVENT_ID,
		mode: ConversationModes.Direct,
		participants: [
			{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" },
			{ userId: "user-2", visibleFromPosition: "2", joinedAt: "2026-09-02T00:00:00.000Z" },
		],
		agent: null,
		...overrides,
	} as const;
}

function _Stored(overrides: Record<string, unknown> = {})
{
	return {
		id: "reservation-1",
		siloId: _SILO_ID,
		principalId: _PRINCIPAL_ID,
		requestId: _REQUEST_ID,
		requestDigest: _DIGEST,
		conversationId: _CONVERSATION_ID,
		historyEventId: _HISTORY_EVENT_ID,
		authorizationDecisionEvidenceId: _EVIDENCE.decisionEvidenceId,
		mode: ConversationMode.Direct,
		agentServiceId: null,
		agentRevisionId: null,
		agentIdentityId: null,
		profileRevisionId: null,
		computerId: null,
		computerHistoryEventId: null,
		state: ConversationCreationReservationState.Reserved,
		participants: [
			{ userId: "user-1", visibleFromPosition: 1n, joinedAt: new Date("2026-09-02T00:00:00.000Z") },
			{ userId: "user-2", visibleFromPosition: 2n, joinedAt: new Date("2026-09-02T00:00:00.000Z") },
		],
		...overrides,
	};
}

function _Caller()
{
	return { siloId: _SILO_ID, principalId: _PRINCIPAL_ID, subjectId: "user-1", issuer: "https://issuer.example.test" };
}

describe("PrismaConversationCreationReservationRepository", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.restoreAllMocks();
	});

	it("commits one authorization-evidenced direct command with replayable coordinates", async function _Reserves()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(_Stored()) } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		const result = await new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command());
		expect(result).toMatchObject({ outcome: "reserved", value: { authorizationEvidenceId: "decision-1", participants: [{ visibleFromPosition: "1" }, { visibleFromPosition: "2" }], agent: null } });
		expect(admission).toHaveBeenCalledWith(expect.objectContaining({ principalId: _PRINCIPAL_ID }), expect.anything(), ProductAuthorizationActions.Create, expect.objectContaining({ requestId: _REQUEST_ID, conversationId: _CONVERSATION_ID }));
		expect(database.conversationCreationReservation.create).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				historyEventId: _HISTORY_EVENT_ID,
				authorizationDecisionEvidenceId: "decision-1",
				participants: { create: expect.arrayContaining([expect.objectContaining({ ordinal: 1, visibleFromPosition: 1n }), expect.objectContaining({ ordinal: 2, visibleFromPosition: 2n })]) },
			}),
		}));
	});

	it("returns the exact prior command without a second authorization decision", async function _Recovers()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), create: vi.fn() } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command())).resolves.toMatchObject({ outcome: "idempotent", value: { reservationId: "reservation-1" } });
		expect(admission).not.toHaveBeenCalled();
		expect(database.conversationCreationReservation.create).not.toHaveBeenCalled();
	});

	it("rejects a changed body under an existing retry key before authorization", async function _RejectsChangedRetry()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), create: vi.fn() } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command({ requestDigest: `sha256:${"e".repeat(64)}` }))).resolves.toEqual({ outcome: "idempotency_conflict" });
		expect(admission).not.toHaveBeenCalled();
	});

	it("leaves no reservation when collection creation is denied", async function _Denies()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(null);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command())).resolves.toEqual({ outcome: "denied" });
		expect(database.conversationCreationReservation.create).not.toHaveBeenCalled();
	});

	it("rejects an agent command without server-owned agent coordinates before audit evidence", async function _RejectsIncompleteAgent()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn(), create: vi.fn() } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent: null }))).rejects.toThrow("one participant and server agent coordinates");
		expect(admission).not.toHaveBeenCalled();
	});

	it("advances a direct reservation only after its history anchor and keeps its projection facts agent-free", async function _AnchorsDirect()
	{
		const anchored = _Stored({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z") });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), update: vi.fn().mockResolvedValue(anchored) } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1", agentBinding: null })).resolves.toMatchObject({ state: "history_anchored", resolvedAgentBinding: null });
		expect(database.conversationCreationReservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, agentIdentityId: null, profileRevisionId: null }) }));
	});

	it("refuses to anchor an agent reservation before its identity and profile are resolved", async function _RejectsIncompleteAnchoredAgent()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored({ mode: ConversationMode.AgentSession, agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _CONVERSATION_ID, computerHistoryEventId: _HISTORY_EVENT_ID })), update: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1", agentBinding: null })).rejects.toThrow("require an agent binding");
		expect(database.conversationCreationReservation.update).not.toHaveBeenCalled();
	});

	it("records the full resolved Agent binding with an agent conversation history anchor", async function _AnchorsAgent()
	{
		const reserved = _Stored({ mode: ConversationMode.AgentSession, agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _CONVERSATION_ID, computerHistoryEventId: _HISTORY_EVENT_ID });
		const anchored = { ...reserved, state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), agentIdentityId: "identity-1", profileRevisionId: "profile-1" };
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(reserved), update: vi.fn().mockResolvedValue(anchored) } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1", agentBinding: { agentIdentityId: "identity-1", profileRevisionId: "profile-1" } })).resolves.toMatchObject({ state: "history_anchored", resolvedAgentBinding: { agentIdentityId: "identity-1", profileRevisionId: "profile-1" } });
	});

	it("returns an exact anchored retry without rewriting its Agent binding", async function _RecoversAnchoredAgent()
	{
		const anchored = _Stored({ mode: ConversationMode.AgentSession, agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _CONVERSATION_ID, computerHistoryEventId: _HISTORY_EVENT_ID, state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), agentIdentityId: "identity-1", profileRevisionId: "profile-1" });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(anchored), update: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1", agentBinding: { agentIdentityId: "identity-1", profileRevisionId: "profile-1" } })).resolves.toMatchObject({ resolvedAgentBinding: { agentIdentityId: "identity-1" } });
		expect(database.conversationCreationReservation.update).not.toHaveBeenCalled();
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1", agentBinding: { agentIdentityId: "identity-2", profileRevisionId: "profile-1" } })).rejects.toThrow("conflicting agent binding");
	});
});
