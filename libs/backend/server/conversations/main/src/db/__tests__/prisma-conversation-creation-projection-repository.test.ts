import { ConversationCreationReservationState, ConversationMode } from "@prisma/client";
import { ConversationLifecycleModes, type ConversationCreated } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationCreationProjectionRepository } from "../prisma-conversation-creation-projection-repository";

const _COMMAND = { reservationId: "reservation-1", siloId: "silo-1", conversationId: "conversation-1", historyRevision: 0n } as const;

/** Builds the immutable revision-zero payload accepted by a matching direct reservation. */
function _Created(overrides: Partial<ConversationCreated> = {}): ConversationCreated
{
	return {
		schemaVersion: 1,
		conversationId: _COMMAND.conversationId,
		mode: ConversationLifecycleModes.Direct,
		participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" }, { userId: "user-2", visibleFromPosition: "2", joinedAt: "2026-09-02T00:00:00.000Z" }],
		agentBinding: null,
		createdAt: "2026-09-02T00:00:00.000Z",
		provenance: { principalId: "principal-1", authorizationEvidenceId: "decision-1", requestId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651" },
		...overrides,
	};
}

/** Builds a history-anchored reservation with the participant order the immutable anchor must retain. */
function _Reservation(overrides: Record<string, unknown> = {})
{
	return {
		id: _COMMAND.reservationId,
		siloId: _COMMAND.siloId,
		conversationId: _COMMAND.conversationId,
		principalId: "principal-1",
		mode: ConversationMode.Direct,
		state: ConversationCreationReservationState.HistoryAnchored,
		historyRevision: 0n,
		agentServiceId: null,
		agentRevisionId: null,
		agentIdentityId: null,
		profileRevisionId: null,
		computerId: null,
		participants: [{ userId: "user-1", visibleFromPosition: 1n }, { userId: "user-2", visibleFromPosition: 2n }],
		...overrides,
	};
}

/** Builds transaction delegates for an already-materialized direct conversation replay. */
function _Database(reservation = _Reservation())
{
	return {
		conversationCreationReservation: { findUnique: vi.fn().mockResolvedValue(reservation), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		conversation: { findUnique: vi.fn().mockResolvedValue({ siloId: _COMMAND.siloId, mode: ConversationMode.Direct, agentServiceId: null }), create: vi.fn() },
		conversationParticipant: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue(reservation.participants) },
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "user-1" }, { id: "principal-2", subject: "user-2" }]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), create: vi.fn() },
		auditEntry: { create: vi.fn() },
	};
}

describe("PrismaConversationCreationProjectionRepository", function _Suite()
{
	it("materializes an exact immutable direct anchor before advancing the reservation", async function _Projects()
	{
		const database = _Database();
		await new PrismaConversationCreationProjectionRepository(database as never).project(_COMMAND, _Created());
		expect(database.conversationCreationReservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: _COMMAND.reservationId, state: ConversationCreationReservationState.HistoryAnchored } }));
	});

	it("rejects a mismatched immutable Agent binding before it writes or advances", async function _RejectsMismatchedAgent()
	{
		const reservation = _Reservation({ mode: ConversationMode.AgentSession, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", computerId: "computer-1", participants: [{ userId: "user-1", visibleFromPosition: 1n }] });
		const database = _Database(reservation);
		const created = _Created({ mode: ConversationLifecycleModes.Agent, participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" }], agentBinding: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "other-identity", profileRevisionId: "profile-1", computerId: "computer-1" } });
		await expect(new PrismaConversationCreationProjectionRepository(database as never).project(_COMMAND, created)).rejects.toThrow("agent binding does not match");
		expect(database.conversation.create).not.toHaveBeenCalled();
		expect(database.conversationCreationReservation.updateMany).not.toHaveBeenCalled();
	});
});
