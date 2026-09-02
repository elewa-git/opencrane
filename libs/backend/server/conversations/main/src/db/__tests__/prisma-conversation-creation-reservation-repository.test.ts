import { ConversationCreationReservationState, ConversationMode } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";
import { ConversationModes } from "@opencrane/models/conversations";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationCreationReservationRepository } from "../prisma-conversation-creation-reservation-repository";
import { PrismaConversationProductAuthorizationRepository } from "../conversation-product-authorization";
import { ConversationCreationReservationOutcomes } from "../../conversation-creation-reservation.types";

const _SILO_ID = "silo-1";
const _PRINCIPAL_ID = "principal-1";
const _REQUEST_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _CONVERSATION_ID = "31c1f1dc-0011-4f13-9c2f-d3841ffd6651";
/** Supplies the DNS-label computer identity required by the Agent Sandbox claim contract. */
const _COMPUTER_ID = `computer-${_CONVERSATION_ID}`;
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
		agentBinding: null,
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
		computerClaimEventId: null,
		computerActivationEventId: null,
		computerLeaseClaimedAt: null,
		computerLeaseExpiresAt: null,
		reservedAt: new Date("2026-09-02T00:00:00.000Z"),
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
		expect(result).toMatchObject({ outcome: ConversationCreationReservationOutcomes.Reserved, value: { authorizationEvidenceId: "decision-1", createdAt: "2026-09-02T00:00:00.000Z", participants: [{ visibleFromPosition: "1" }, { visibleFromPosition: "2" }], agent: null } });
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
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command())).resolves.toMatchObject({ outcome: ConversationCreationReservationOutcomes.Idempotent, value: { reservationId: "reservation-1" } });
		expect(admission).not.toHaveBeenCalled();
		expect(database.conversationCreationReservation.create).not.toHaveBeenCalled();
	});

	it("rejects a changed body under an existing retry key before authorization", async function _RejectsChangedRetry()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), create: vi.fn() } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command({ requestDigest: `sha256:${"e".repeat(64)}` }))).resolves.toEqual({ outcome: ConversationCreationReservationOutcomes.IdempotencyConflict });
		expect(admission).not.toHaveBeenCalled();
	});

	it("leaves no reservation when collection creation is denied", async function _Denies()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(null);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command())).resolves.toEqual({ outcome: ConversationCreationReservationOutcomes.Denied });
		expect(database.conversationCreationReservation.create).not.toHaveBeenCalled();
	});

	it("rejects an agent command without server-owned agent coordinates before audit evidence", async function _RejectsIncompleteAgent()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn(), create: vi.fn() } };
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent: null }))).rejects.toThrow("server agent coordinates, and a frozen binding");
		expect(admission).not.toHaveBeenCalled();
	});

	it("advances a direct reservation only after its history anchor and keeps its projection facts agent-free", async function _AnchorsDirect()
	{
		const anchored = _Stored({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z") });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), update: vi.fn().mockResolvedValue(anchored) } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1" })).resolves.toMatchObject({ state: "history_anchored", agentBinding: null });
		expect(database.conversationCreationReservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n }) }));
	});

	it("does not advance another caller's reservation by its identifier", async function _ScopesAnchorAdvance()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored({ principalId: "principal-2" })), update: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1" })).rejects.toThrow("reservation is unavailable");
		expect(database.conversationCreationReservation.update).not.toHaveBeenCalled();
	});

	it("marks a history-anchored reservation projected only after directory convergence", async function _Projects()
	{
		const projected = _Stored({ state: ConversationCreationReservationState.Projected, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), projectedAt: new Date("2026-09-02T00:02:00.000Z") });
		const anchored = _Stored({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z") });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValueOnce(anchored).mockResolvedValueOnce(projected), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markProjected({ reservationId: "reservation-1" })).resolves.toMatchObject({ state: "projected" });
		expect(database.conversationCreationReservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "reservation-1", state: ConversationCreationReservationState.HistoryAnchored }, data: expect.objectContaining({ state: ConversationCreationReservationState.Projected, projectedAt: expect.any(Date) }) }));
	});

	it("does not project an unanchored reservation", async function _RejectsUnanchoredProjection()
	{
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(_Stored()), update: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markProjected({ reservationId: "reservation-1" })).rejects.toThrow("requires a history-anchored reservation");
		expect(database.conversationCreationReservation.update).not.toHaveBeenCalled();
	});

	it("returns a projected reservation without attempting a second transition", async function _RecoversProjected()
	{
		const projected = _Stored({ state: ConversationCreationReservationState.Projected, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), projectedAt: new Date("2026-09-02T00:02:00.000Z") });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(projected), updateMany: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markProjected({ reservationId: "reservation-1" })).resolves.toMatchObject({ state: "projected" });
		expect(database.conversationCreationReservation.updateMany).not.toHaveBeenCalled();
	});

	it("returns the competing projector's completed transition after a lost compare-and-swap race", async function _RecoversProjectionRace()
	{
		const anchored = _Stored({ state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z") });
		const projected = _Stored({ state: ConversationCreationReservationState.Projected, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), projectedAt: new Date("2026-09-02T00:02:00.000Z") });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValueOnce(anchored).mockResolvedValueOnce(projected), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markProjected({ reservationId: "reservation-1" })).resolves.toMatchObject({ state: "projected" });
	});

	it("commits the full Agent binding with its initial reservation before history I/O", async function _ReservesAgent()
	{
		const agent = { agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _COMPUTER_ID, computerHistoryEventId: _HISTORY_EVENT_ID, computerClaimEventId: "31c1f1dc-0013-4f13-9c2f-d3841ffd6651", computerActivationEventId: "31c1f1dc-0014-4f13-9c2f-d3841ffd6651", computerLeaseClaimedAt: "2026-09-02T00:00:00.000Z", computerLeaseExpiresAt: "2026-09-02T00:20:00.000Z" };
		const agentBinding = { agentIdentityId: "identity-1", profileRevisionId: "profile-1" };
		const stored = _Stored({ mode: ConversationMode.AgentSession, participants: [_Stored().participants[0]], ...agent, computerLeaseClaimedAt: new Date(agent.computerLeaseClaimedAt), computerLeaseExpiresAt: new Date(agent.computerLeaseExpiresAt), ...agentBinding });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(stored) } };
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admitEvidence").mockResolvedValue(_EVIDENCE);
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).reserve(_Command({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent, agentBinding }))).resolves.toMatchObject({ value: { agentBinding } });
		expect(database.conversationCreationReservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(agentBinding) }));
	});

	it("returns an exact anchored retry without rewriting its frozen Agent binding", async function _RecoversAnchoredAgent()
	{
		const anchored = _Stored({ mode: ConversationMode.AgentSession, agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _COMPUTER_ID, computerHistoryEventId: _HISTORY_EVENT_ID, computerClaimEventId: "31c1f1dc-0013-4f13-9c2f-d3841ffd6651", computerActivationEventId: "31c1f1dc-0014-4f13-9c2f-d3841ffd6651", computerLeaseClaimedAt: new Date("2026-09-02T00:00:00.000Z"), computerLeaseExpiresAt: new Date("2026-09-02T00:20:00.000Z"), state: ConversationCreationReservationState.HistoryAnchored, historyRevision: 0n, historyAnchoredAt: new Date("2026-09-02T00:01:00.000Z"), agentIdentityId: "identity-1", profileRevisionId: "profile-1" });
		const database = { conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(anchored), update: vi.fn() } };
		await expect(new PrismaConversationCreationReservationRepository(database as never, _Caller()).markHistoryAnchored({ reservationId: "reservation-1" })).resolves.toMatchObject({ agentBinding: { agentIdentityId: "identity-1" } });
		expect(database.conversationCreationReservation.update).not.toHaveBeenCalled();
	});
});
