import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationComputerParticipantInputAuthorizationAuthority } from "../prisma-conversation-computer-participant-input-authorizer";
import { PrismaConversationProductAuthorizationRepository } from "../conversation-product-authorization";
import type { ConversationCaller } from "../../types/conversation-caller.types";

/** Fixes the session-derived caller used by every current-authority test. */
const _CALLER: ConversationCaller = { siloId: "testv5", principalId: "principal-1", subjectId: "subject-1", issuer: "https://issuer.example" };
/** Fixes the immutable input id whose text never enters authorization arguments. */
const _INPUT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds transaction doubles whose reads retain the current target binding. */
function _Database(overrides: { readonly membership?: { readonly displayName: string | null } | null; readonly conversation?: { readonly agentServiceId: string | null } | null; readonly reservation?: { readonly computerId: string | null; readonly agentServiceId: string | null } | null } = {})
{
	return {
		orgMembership: { findFirst: vi.fn().mockResolvedValue(overrides.membership === undefined ? { displayName: "Jente" } : overrides.membership) },
		conversation: { findFirst: vi.fn().mockResolvedValue(overrides.conversation === undefined ? { agentServiceId: "service-1" } : overrides.conversation) },
		conversationCreationReservation: { findFirst: vi.fn().mockResolvedValue(overrides.reservation === undefined ? { computerId: "computer-1", agentServiceId: "service-1" } : overrides.reservation) },
	};
}

/** Restores authorization seams so one denial case cannot influence another. */
afterEach(function _RestoreMocks()
{
	vi.restoreAllMocks();
});

describe("PrismaConversationComputerParticipantInputAuthorizationAuthority", function _PrismaConversationComputerParticipantInputAuthorizationAuthoritySuite()
{
	it("returns only current server-derived computer and author coordinates after recording Use evidence", async function _AuthorizesCurrentParticipant()
	{
		const database = _Database();
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit").mockResolvedValue(true);
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toEqual({ computerId: "computer-1", author: { principalId: "principal-1", participantId: "subject-1", name: "Jente", avatarArtifactRevisionId: null } });

		expect(admission).toHaveBeenCalledWith(_CALLER, { kind: "conversation", id: "conversation-1" }, "use", { inputId: _INPUT_ID, textDigest: `sha256:${createHash("sha256").update("Please prepare the release notes.", "utf8").digest("hex")}` });
	});

	it("does not record authorization evidence when current membership is unavailable", async function _DeniesInactiveMembership()
	{
		const database = _Database({ membership: null });
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit");
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toBeNull();

		expect(database.conversation.findFirst).not.toHaveBeenCalled();
		expect(admission).not.toHaveBeenCalled();
	});

	it("rejects a malformed input before it records a protected-action decision", async function _RejectsMalformedInput()
	{
		const database = _Database();
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit");
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: "not-a-uuid", text: "Please prepare the release notes." })).resolves.toBeNull();

		expect(database.orgMembership.findFirst).not.toHaveBeenCalled();
		expect(admission).not.toHaveBeenCalled();
	});

	it("rejects a projected computer whose Agent service no longer matches the open conversation", async function _DeniesMismatchedBinding()
	{
		const database = _Database({ reservation: { computerId: "computer-1", agentServiceId: "service-2" } });
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit");
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toBeNull();

		expect(admission).not.toHaveBeenCalled();
	});

	it("denies input when the current Conversation Use decision is refused", async function _DeniesRefusedUse()
	{
		const database = _Database();
		const admission = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit").mockResolvedValue(false);
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toBeNull();

		expect(admission).toHaveBeenCalledOnce();
	});

	it("uses the authenticated subject when membership has no peer-visible display name", async function _UsesSubjectFallback()
	{
		const database = _Database({ membership: { displayName: "  " } });
		vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "admit").mockResolvedValue(true);
		const authorizer = new PrismaConversationComputerParticipantInputAuthorizationAuthority(database as never);

		await expect(authorizer.authorize(_CALLER, "conversation-1", { inputId: _INPUT_ID, text: "Please prepare the release notes." })).resolves.toMatchObject({ author: { name: "subject-1" } });
	});
});
