import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationEntry } from "@opencrane/contracts";
import { ConversationProjectionReadStatuses } from "@opencrane/backend/conversations/projection";

import { PrismaConversationHistoryReplayUnitOfWork } from "../prisma-conversation-history-replay-unit-of-work";

/** Fixes the current participant and conversation coordinates used by every replay command. */
const _COMMAND = { conversationId: "conversation-1", siloId: "testv5", subjectId: "subject-1", cursor: null, limit: 20 };

/** Builds the immutable human-authored input shape accepted by the history reader. */
function _Entry(): ConversationEntry
{
	return {
		schemaVersion: 1,
		id: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
		conversationId: "conversation-1",
		position: "1",
		author: { kind: "human", principalId: "principal-1", participantId: "subject-1", name: "Jente", avatarArtifactRevisionId: null },
		provenance: "human-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
		correlationId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
		idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651",
		occurredAt: "2026-09-02T14:00:00.000Z",
		attestation: null,
		kind: "message",
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: "payload://payload-1", ciphertextDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "start",
	} as ConversationEntry;
}

/** Builds the next immutable message without reusing the first entry's idempotency coordinate. */
function _NextEntry(): ConversationEntry
{
	const first = _Entry();
	const id = "c1f1dc31-0010-4f13-9c2f-d3841ffd6651";
	return { ...first, id, position: "2", causationId: id, correlationId: id, idempotencyKey: id };
}

/** Creates transaction doubles that can change the access decision between history reads. */
function _Subject(memberships: readonly ({ readonly clusterTenant: string } | null)[] = [{ clusterTenant: "testv5" }, { clusterTenant: "testv5" }])
{
	const transaction = {
		orgMembership: { findFirst: vi.fn().mockResolvedValueOnce(memberships[0]).mockResolvedValueOnce(memberships.length > 1 ? memberships[1] : memberships[0]) },
		conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: null }) },
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(operation) { return operation(transaction); }) };
	const conversations = { read: vi.fn().mockResolvedValue({ entries: [_Entry()] }) };
	const payloads = { readText: vi.fn().mockResolvedValue("Hello from immutable history.") };
	return { transaction, prisma, conversations, payloads, authority: new PrismaConversationHistoryReplayUnitOfWork(prisma as never, conversations as never, payloads) };
}

/** Restores test seams so a post-history revocation cannot affect another test. */
afterEach(function _RestoreMocks()
{
	vi.restoreAllMocks();
});

describe("PrismaConversationHistoryReplayUnitOfWork", function _PrismaConversationHistoryReplayUnitOfWorkSuite()
{
	it("reads only current-authorized history and resolves the selected encrypted text reference", async function _ReplaysAuthorizedHistory()
	{
		const subject = _Subject();

		await expect(subject.authority.readAuthorized(_COMMAND)).resolves.toEqual({
			status: ConversationProjectionReadStatuses.Authorized,
			rows: [expect.objectContaining({ conversationId: "conversation-1", position: "1", runId: null, type: "conversation.message", payload: { messageId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", role: "user", state: "completed", blocks: [{ id: "text", kind: "text", value: "Hello from immutable history." }] } })],
		});

		expect(subject.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(subject.conversations.read).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1" });
		expect(subject.payloads.readText).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", idempotencyKey: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", payloadRef: "payload://payload-1", ciphertextDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
	});

	it("does not read immutable history when current membership is unavailable", async function _RejectsMissingMembership()
	{
		const subject = _Subject([null]);

		await expect(subject.authority.readAuthorized(_COMMAND)).resolves.toEqual({ status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] });

		expect(subject.conversations.read).not.toHaveBeenCalled();
		expect(subject.payloads.readText).not.toHaveBeenCalled();
	});

	it("discards the immutable page when access is revoked during its read", async function _RejectsPostHistoryRevocation()
	{
		const subject = _Subject([{ clusterTenant: "testv5" }, null]);

		await expect(subject.authority.readAuthorized(_COMMAND)).resolves.toEqual({ status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] });

		expect(subject.conversations.read).toHaveBeenCalledOnce();
		expect(subject.payloads.readText).not.toHaveBeenCalled();
	});

	it("starts after a legacy cursor that has no AG-UI subframe", async function _SkipsCompletedLegacyCursor()
	{
		const subject = _Subject();
		subject.conversations.read.mockResolvedValue({ entries: [_Entry(), _NextEntry()] });

		const result = await subject.authority.readAuthorized({ ..._COMMAND, cursor: { conversationId: "conversation-1", position: "1" }, limit: 1 });

		expect(result.rows).toEqual([expect.objectContaining({ position: "2" })]);
	});

	it("keeps a subframe-resume row without allowing it to consume the next history page", async function _CarriesSubframeResumeAndNewerRows()
	{
		const subject = _Subject();
		subject.conversations.read.mockResolvedValue({ entries: [_Entry(), _NextEntry()] });

		const result = await subject.authority.readAuthorized({ ..._COMMAND, cursor: { conversationId: "conversation-1", position: "1", subframe: 0 }, limit: 1 });

		expect(result.rows).toEqual([expect.objectContaining({ position: "1" }), expect.objectContaining({ position: "2" })]);
	});
});
