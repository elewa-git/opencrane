import { ConversationEntryKinds, ConversationLifecycleModes, type ConversationCreated, type ConversationEntry, type MessageEntry } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerParticipantInputAuthority } from "../conversation-computer-participant-input-authority";
import { ConversationComputerParticipantInputOutcomes, type ConversationComputerParticipantInputAuthorityDependencies, type ConversationComputerParticipantInputCommand } from "../conversation-computer-participant-input-authority.types";
import type { ConversationHistoryReader } from "../../conversation-history-reader";

/** Fixes the server timestamp that target participant input entries record. */
const _NOW = new Date("2026-09-02T04:30:00.000Z");
/** Reuses a UUID browser retry key as the target immutable input entry identifier. */
const _INPUT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Reuses the first target private payload coordinates in input admission tests. */
const _PAYLOAD = { payloadRef: "payload://31c1f1dc-0010-4f13-9c2f-d3841ffd6651" as const, ciphertextDigest: `sha256:${"a".repeat(64)}` as const };

/** Builds the immutable agent conversation anchor that freezes its logical computer. */
function _Creation(overrides: Partial<ConversationCreated> = {}): ConversationCreated
{
	return {
		schemaVersion: 1,
		conversationId: "conversation-1",
		mode: ConversationLifecycleModes.Agent,
		participants: [{ userId: "participant-1", visibleFromPosition: "1", joinedAt: "2026-09-02T04:00:00.000Z" }],
		agentBinding: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", computerId: "computer-1" },
		createdAt: "2026-09-02T04:00:00.000Z",
		provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1", requestId: "creation-request-1" },
		...overrides,
	};
}

/** Builds a target browser input after membership has already selected its human author. */
function _Command(overrides: Record<string, unknown> = {}): ConversationComputerParticipantInputCommand
{
	return {
		siloId: "testv5",
		conversationId: "conversation-1",
		computerId: "computer-1",
		inputId: _INPUT_ID,
		text: "Please prepare the release notes.",
		author: { principalId: "principal-1", participantId: "participant-1", name: "Jente", avatarArtifactRevisionId: null },
		...overrides,
	};
}

/** Builds the exact durable entry that a response-lost input retry must validate. */
function _ExistingInput(): MessageEntry
{
	return {
		schemaVersion: 1,
		id: _INPUT_ID,
		conversationId: "conversation-1",
		position: "4",
		author: { kind: "human", principalId: "principal-1", participantId: "participant-1", name: "Jente", avatarArtifactRevisionId: null },
		provenance: "human-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: _INPUT_ID,
		correlationId: _INPUT_ID,
		idempotencyKey: _INPUT_ID,
		occurredAt: _NOW.toISOString(),
		attestation: null,
		kind: ConversationEntryKinds.Message,
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: _PAYLOAD.payloadRef, ciphertextDigest: _PAYLOAD.ciphertextDigest }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "start",
	};
}

/** Builds narrow dependency doubles and retains each external write for target admission assertions. */
function _Subject(overrides: { readonly creation?: ConversationCreated; readonly entries?: readonly ConversationEntry[]; readonly revision?: bigint | HistoryExpectedRevisions } = {})
{
	const history = { appendAtomic: vi.fn().mockResolvedValue([]) };
	const conversations = {
		readCreation: vi.fn().mockResolvedValue(overrides.creation ?? _Creation()),
		readCurrent: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", expectedRevision: overrides.revision ?? 3n, entries: overrides.entries ?? [] }),
	};
	const payloads = { storeText: vi.fn().mockResolvedValue(_PAYLOAD) };
	const dependencies = {
		history,
		conversations: conversations as Pick<ConversationHistoryReader, "readCreation" | "readCurrent">,
		payloads,
		clock: { now: function _Now(): Date { return _NOW; } },
	} satisfies ConversationComputerParticipantInputAuthorityDependencies;
	const authority = new ConversationComputerParticipantInputAuthority(dependencies);
	return { authority, history, conversations, payloads };
}

describe("ConversationComputerParticipantInputAuthority", function _ParticipantInputAuthoritySuite()
{
	it("stores one opaque human input entry under the checked conversation head", async function _StoresInput()
	{
		const subject = _Subject();

		await expect(subject.authority.admit(_Command())).resolves.toEqual({ outcome: ConversationComputerParticipantInputOutcomes.Accepted, inputEntryId: _INPUT_ID });

		expect(subject.payloads.storeText).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", idempotencyKey: _INPUT_ID, text: "Please prepare the release notes." });
		expect(subject.history.appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "conversation-conversation-1", revision: 3n }] }));
		const append = subject.history.appendAtomic.mock.calls[0][0];
		expect(append.appends[0].events[0]).toMatchObject({ id: _INPUT_ID, data: { entry: { id: _INPUT_ID, position: "4", author: { kind: "human", principalId: "principal-1", participantId: "participant-1" }, activation: "start", blocks: [{ payloadRef: _PAYLOAD.payloadRef, ciphertextDigest: _PAYLOAD.ciphertextDigest }] } } });
	});

	it("reuses the matching opaque entry after a response-lost retry", async function _ReplaysInput()
	{
		const subject = _Subject({ entries: [_ExistingInput()] });

		await expect(subject.authority.admit(_Command())).resolves.toEqual({ outcome: ConversationComputerParticipantInputOutcomes.Idempotent, inputEntryId: _INPUT_ID });

		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
		expect(subject.payloads.storeText).toHaveBeenCalledTimes(1);
	});

	it("rejects a computer that was not frozen into the agent conversation anchor", async function _RejectsForeignComputer()
	{
		const subject = _Subject();

		await expect(subject.authority.admit(_Command({ computerId: "computer-2" }))).rejects.toThrow("creation-bound agent computer");

		expect(subject.conversations.readCurrent).not.toHaveBeenCalled();
		expect(subject.payloads.storeText).not.toHaveBeenCalled();
	});

	it("rejects a human author that is not a participant recorded at conversation creation", async function _RejectsForeignParticipant()
	{
		const subject = _Subject();

		await expect(subject.authority.admit(_Command({ author: { principalId: "principal-2", participantId: "participant-2", name: "Other", avatarArtifactRevisionId: null } }))).rejects.toThrow("not an initial participant");

		expect(subject.conversations.readCurrent).not.toHaveBeenCalled();
		expect(subject.payloads.storeText).not.toHaveBeenCalled();
	});

	it("rejects a stored entry when the retry changes its participant input", async function _RejectsChangedRetry()
	{
		const subject = _Subject({ entries: [{ ..._ExistingInput(), activation: "none" }] });

		await expect(subject.authority.admit(_Command())).rejects.toThrow("already owns different input");

		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
	});
});
