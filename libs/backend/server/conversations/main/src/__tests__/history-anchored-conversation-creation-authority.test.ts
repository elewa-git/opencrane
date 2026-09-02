import { ConversationModes } from "@opencrane/models/conversations";
import type { HistoryAppendReceipt } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationCreationReservationOutcomes, ConversationCreationReservationStates, type ReserveConversationCreationCommand, type ReservedConversationCreation } from "../conversation-creation-reservation.types";
import { HistoryAnchoredConversationCreationAuthority } from "../history-anchored-conversation-creation-authority";
import { HistoryAnchoredConversationCreationOutcomes, type ConversationCreationProjectionPort, type ConversationCreationReservationUnitOfWork } from "../history-anchored-conversation-creation-authority.types";
import type { ConversationHistoryAuthority } from "../conversation-history-authority";
import type { ConversationCreationAnchorVerifier } from "../conversation-creation-anchor-verifier";
import { ConversationCreationAnchorConfirmationOutcomes, type ConversationCreationAnchorConfirmation } from "../conversation-creation-anchor-verifier.types";

/** Supplies the stable server-generated request UUID used by a browser retry. */
const _REQUEST_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Supplies the stable server-generated conversation UUID used by immutable history. */
const _CONVERSATION_ID = "31c1f1dc-0011-4f13-9c2f-d3841ffd6651";
/** Supplies the revision-zero event UUID reserved before the history append. */
const _EVENT_ID = "31c1f1dc-0012-4f13-9c2f-d3841ffd6651";

/** Builds one direct command that a caller already resolved without a browser-selected history record. */
function _Command(overrides: Partial<ReserveConversationCreationCommand> = {}): ReserveConversationCreationCommand
{
	return {
		siloId: "silo-1",
		principalId: "principal-1",
		requestId: _REQUEST_ID,
		requestDigest: `sha256:${"a".repeat(64)}`,
		conversationId: _CONVERSATION_ID,
		historyEventId: _EVENT_ID,
		mode: ConversationModes.Direct,
		participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" }, { userId: "user-2", visibleFromPosition: "2", joinedAt: "2026-09-02T00:00:00.000Z" }],
		agent: null,
		agentBinding: null,
		...overrides,
	};
}

/** Builds the durable reservation returned by either serializable reservation operation. */
function _Reservation(overrides: Partial<ReservedConversationCreation> = {}): ReservedConversationCreation
{
	return {
		reservationId: "reservation-1",
		createdAt: "2026-09-02T00:00:00.000Z",
		..._Command(),
		authorizationEvidenceId: "decision-1",
		state: ConversationCreationReservationStates.Reserved,
		...overrides,
	};
}

/** Creates test ports whose calls expose the order across PostgreSQL, history, and projection ownership. */
function _Ports(reservation: ReservedConversationCreation = _Reservation())
{
	const phases: string[] = [];
	const reservations: ConversationCreationReservationUnitOfWork = {
		reserve: vi.fn(async function _Reserve() { phases.push("reserve"); return { outcome: ConversationCreationReservationOutcomes.Reserved, value: reservation } as const; }),
		markHistoryAnchored: vi.fn(async function _Mark() { phases.push("mark"); return { ...reservation, state: ConversationCreationReservationStates.HistoryAnchored }; }),
	};
	const historyCreate = vi.fn(async function _Create(): Promise<HistoryAppendReceipt> { phases.push("history"); return { streamName: `conversation-${_CONVERSATION_ID}`, revision: 0n }; });
	const history: Pick<ConversationHistoryAuthority, "create"> = { create: historyCreate };
	const anchorConfirm = vi.fn(async function _Confirm(): Promise<ConversationCreationAnchorConfirmation> { phases.push("confirm"); return { outcome: ConversationCreationAnchorConfirmationOutcomes.Confirmed, revision: 0n }; });
	const anchorVerifier: Pick<ConversationCreationAnchorVerifier, "confirm"> = { confirm: anchorConfirm };
	const projection: ConversationCreationProjectionPort = { request: vi.fn(async function _Request() { phases.push("projection"); }) };
	return { phases, reservations, history, historyCreate, anchorVerifier, anchorConfirm, projection };
}

describe("HistoryAnchoredConversationCreationAuthority", function _Suite()
{
	it("reserves before history, marks the exact anchor, and requests a projection", async function _Creates()
	{
		const ports = _Ports();
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		const result = await authority.create({ reservation: _Command() });
		expect(result).toMatchObject({ outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded, created: { conversationId: _CONVERSATION_ID, createdAt: "2026-09-02T00:00:00.000Z", agentBinding: null }, projection: { historyRevision: 0n } });
		expect(ports.phases).toEqual(["reserve", "history", "mark", "projection"]);
		expect(ports.history.create).toHaveBeenCalledWith(expect.objectContaining({ eventId: _EVENT_ID, created: expect.objectContaining({ provenance: { principalId: "principal-1", authorizationEvidenceId: "decision-1", requestId: _REQUEST_ID } }) }));
		expect(ports.reservations.markHistoryAnchored).toHaveBeenCalledWith({ reservationId: "reservation-1" });
	});

	it("does not touch history or projection after a product authorization denial", async function _Denies()
	{
		const ports = _Ports();
		ports.reservations.reserve = vi.fn(async function _Deny() { return { outcome: ConversationCreationReservationOutcomes.Denied } as const; });
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		await expect(authority.create({ reservation: _Command() })).resolves.toEqual({ outcome: HistoryAnchoredConversationCreationOutcomes.Denied });
		expect(ports.history.create).not.toHaveBeenCalled();
		expect(ports.projection.request).not.toHaveBeenCalled();
	});

	it("confirms the exact anchor after an ambiguous append response before it marks the reservation", async function _RecoversAmbiguousAppend()
	{
		const ports = _Ports();
		ports.historyCreate.mockImplementationOnce(async function _LostResponse() { ports.phases.push("history"); throw new Error("response lost"); });
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		await expect(authority.create({ reservation: _Command() })).resolves.toMatchObject({ outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded });
		expect(ports.phases).toEqual(["reserve", "history", "confirm", "mark", "projection"]);
		expect(ports.anchorVerifier.confirm).toHaveBeenCalledWith(expect.objectContaining({ eventId: _EVENT_ID, created: expect.objectContaining({ createdAt: "2026-09-02T00:00:00.000Z" }) }));
	});

	it("retries one absent stream only after the verifier declines to invent a committed append", async function _RetriesAbsentAnchor()
	{
		const ports = _Ports();
		ports.historyCreate.mockImplementationOnce(async function _LostResponse() { ports.phases.push("history"); throw new Error("response lost"); });
		ports.anchorConfirm.mockImplementationOnce(async function _Absent(): Promise<ConversationCreationAnchorConfirmation> { ports.phases.push("confirm"); return { outcome: ConversationCreationAnchorConfirmationOutcomes.Absent }; });
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		await expect(authority.create({ reservation: _Command() })).resolves.toMatchObject({ outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded });
		expect(ports.phases).toEqual(["reserve", "history", "confirm", "history", "mark", "projection"]);
	});

	it("replays an anchored reservation without a second history append", async function _ResumesAnchored()
	{
		const anchored = _Reservation({ state: ConversationCreationReservationStates.HistoryAnchored });
		const ports = _Ports(anchored);
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		await expect(authority.create({ reservation: _Command() })).resolves.toMatchObject({ outcome: HistoryAnchoredConversationCreationOutcomes.ProjectionNeeded });
		expect(ports.history.create).not.toHaveBeenCalled();
		expect(ports.phases).toEqual(["reserve", "mark", "projection"]);
	});

	it("recovers an Agent anchor with its originally frozen binding after the progress transaction fails", async function _RecoversAgentAnchor()
	{
		const frozenBinding = { agentIdentityId: "identity-1", profileRevisionId: "profile-1" };
		const agentReservation = _Reservation({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: _CONVERSATION_ID, computerHistoryEventId: _EVENT_ID }, agentBinding: frozenBinding });
		const ports = _Ports(agentReservation);
		let markAttempts = 0;
		ports.reservations.markHistoryAnchored = vi.fn(async function _FailThenAdvance()
		{
			markAttempts += 1;
			if (markAttempts === 1)
				throw new Error("transaction lost");
			return { ...agentReservation, state: ConversationCreationReservationStates.HistoryAnchored };
		});
		ports.historyCreate.mockImplementationOnce(async function _FirstAppend() { ports.phases.push("history"); return { streamName: `conversation-${_CONVERSATION_ID}`, revision: 0n }; });
		ports.historyCreate.mockImplementationOnce(async function _ExistingAnchor() { ports.phases.push("history"); throw new Error("already created"); });
		const authority = new HistoryAnchoredConversationCreationAuthority(ports.reservations, ports.history, ports.anchorVerifier, ports.projection);
		await expect(authority.create({ reservation: _Command({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent: agentReservation.agent, agentBinding: frozenBinding }) })).rejects.toThrow("transaction lost");
		await expect(authority.create({ reservation: _Command({ mode: ConversationModes.AgentSession, participants: [_Command().participants[0]], agent: agentReservation.agent, agentBinding: { agentIdentityId: "identity-2", profileRevisionId: "profile-2" } }) })).resolves.toMatchObject({ created: { agentBinding: expect.objectContaining(frozenBinding) } });
		expect(ports.anchorVerifier.confirm).toHaveBeenCalledWith(expect.objectContaining({ created: expect.objectContaining({ agentBinding: expect.objectContaining(frozenBinding) }) }));
	});
});
