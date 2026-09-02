import { describe, expect, it, vi } from "vitest";

import { __AgentSandboxClaimName } from "@opencrane/backend/server/infra/agent-sandbox-claims";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { ConversationModes } from "@opencrane/models/conversations";

import { ConversationComputerCreationActivationAuthority } from "../conversation-computer-creation-activation-authority";
import { ConversationCreationReservationStates } from "../conversation-creation-reservation.types";

/** Builds one immutable agent creation reservation with all initial computer coordinates frozen. */
function _Reservation()
{
	return {
		reservationId: "reservation-1",
		siloId: "silo-1",
		principalId: "principal-1",
		requestId: "00000000-0000-4000-8000-000000000001",
		requestDigest: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const,
		conversationId: "conversation-1",
		historyEventId: "00000000-0000-4000-8000-000000000002",
		mode: ConversationModes.AgentSession,
		participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-02T00:00:00.000Z" }],
		agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", computerId: "computer-00000000-0000-4000-8000-000000000003", computerHistoryEventId: "00000000-0000-4000-8000-000000000004", computerClaimEventId: "00000000-0000-4000-8000-000000000005", computerActivationEventId: "00000000-0000-4000-8000-000000000006", computerLeaseClaimedAt: "2026-09-02T00:00:00.000Z", computerLeaseExpiresAt: "2026-09-02T00:20:00.000Z" },
		agentBinding: { agentIdentityId: "identity-1", profileRevisionId: "profile-1" },
		createdAt: "2026-09-02T00:00:00.000Z",
		authorizationEvidenceId: "evidence-1",
		state: ConversationCreationReservationStates.HistoryAnchored,
	};
}

describe("ConversationComputerCreationActivationAuthority", function _Suite()
{
	it("atomically requests the frozen initial pending generation after a conversation anchor", async function _RequestsInitialGeneration()
	{
		const provisionAndRequestActivation = vi.fn().mockResolvedValue(undefined);
		const subject = new ConversationComputerCreationActivationAuthority({ history: { provisionAndRequestActivation, load: vi.fn() }, clock: { now: function _Now() { return new Date("2026-09-02T00:00:00.000Z"); } } });

		await subject.ensure(_Reservation());

		expect(provisionAndRequestActivation).toHaveBeenCalledWith(expect.objectContaining({ provisionEventId: "00000000-0000-4000-8000-000000000004", claimEventId: "00000000-0000-4000-8000-000000000005", activationEventId: "00000000-0000-4000-8000-000000000006", computer: expect.objectContaining({ state: ConversationComputerStates.Cold, leaseGeneration: 0 }), lease: expect.objectContaining({ state: ComputerLeaseStates.Claimed, sandboxClaimId: __AgentSandboxClaimName("computer-00000000-0000-4000-8000-000000000003", 1) }) }));
	});

	it("recovers an initial generation after the activation worker already advanced the computer", async function _RecoversAdvancedGeneration()
	{
		const reservation = _Reservation();
		const provisionAndRequestActivation = vi.fn().mockRejectedValue(new Error("response lost"));
		const load = vi.fn().mockResolvedValue({ revision: 2n, computer: { id: reservation.agent.computerId, siloId: reservation.siloId, conversationId: reservation.conversationId, agentIdentityId: reservation.agentBinding.agentIdentityId, profileRevisionId: reservation.agentBinding.profileRevisionId, leaseGeneration: 1, createdAt: reservation.createdAt }, lease: { id: `lease-${reservation.agent.computerId}-g1`, generation: 1, sandboxClaimId: __AgentSandboxClaimName(reservation.agent.computerId, 1) } });
		const subject = new ConversationComputerCreationActivationAuthority({ history: { provisionAndRequestActivation, load }, clock: { now: function _Now() { return new Date("2026-09-02T00:00:00.000Z"); } } });

		await expect(subject.ensure(reservation)).resolves.toBeUndefined();
	});

	it("refreshes an uncommitted initial lease window after its reserved deadline elapsed", async function _RefreshesExpiredInitialLease()
	{
		const provisionAndRequestActivation = vi.fn().mockResolvedValue(undefined);
		const subject = new ConversationComputerCreationActivationAuthority({ history: { provisionAndRequestActivation, load: vi.fn() }, clock: { now: function _Now() { return new Date("2026-09-02T01:00:00.000Z"); } } });

		await subject.ensure(_Reservation());

		expect(provisionAndRequestActivation).toHaveBeenCalledWith(expect.objectContaining({ lease: expect.objectContaining({ claimedAt: "2026-09-02T01:00:00.000Z", expiresAt: "2026-09-02T01:20:00.000Z" }) }));
	});
});
