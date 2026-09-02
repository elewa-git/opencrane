import { ConversationEntryKinds, type ConversationEntry, type MessageEntry } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerParticipantInputDispatchAuthority } from "../conversation-computer-participant-input-dispatch-authority";
import type { ConversationComputerParticipantInputDispatchAuthorityDependencies } from "../conversation-computer-participant-input-dispatch-authority.types";
import type { ConversationComputerRuntimeCommandAuthority } from "../conversation-computer-runtime-command-authority";
import type { ConversationHistoryReader } from "../../conversation-history-reader";

/** Reuses a UUID participant input id as the runtime command idempotency key. */
const _INPUT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Reuses private payload coordinates that satisfy the target runtime command contract. */
const _PAYLOAD = { payloadRef: "payload://31c1f1dc-0010-4f13-9c2f-d3841ffd6651" as const, ciphertextDigest: `sha256:${"a".repeat(64)}` as const };

/** Builds a retained human start entry that a warm computer must receive as work. */
function _Input(overrides: Partial<MessageEntry> = {}): MessageEntry
{
	return {
		schemaVersion: 1,
		id: _INPUT_ID,
		conversationId: "conversation-1",
		position: "1",
		author: { kind: "human", principalId: "principal-1", participantId: "participant-1", name: "Jente", avatarArtifactRevisionId: null },
		provenance: "human-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: _INPUT_ID,
		correlationId: _INPUT_ID,
		idempotencyKey: _INPUT_ID,
		occurredAt: "2026-09-02T04:30:00.000Z",
		attestation: null,
		kind: ConversationEntryKinds.Message,
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: _PAYLOAD.payloadRef, ciphertextDigest: _PAYLOAD.ciphertextDigest }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "start",
		...overrides,
	};
}

/** Builds command and history ports whose calls show which input work reached the active execution. */
function _Subject(entries: readonly ConversationEntry[] = [_Input()])
{
	const conversations = { readCurrent: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", expectedRevision: 1n, entries }) };
	const commands = { issueNextStartTurn: vi.fn().mockResolvedValue({ command: {} }) };
	const dependencies = {
		conversations: conversations as Pick<ConversationHistoryReader, "readCurrent">,
		commands: commands as Pick<ConversationComputerRuntimeCommandAuthority, "issueNextStartTurn">,
	} satisfies ConversationComputerParticipantInputDispatchAuthorityDependencies;
	const authority = new ConversationComputerParticipantInputDispatchAuthority(dependencies);
	return { authority, conversations, commands };
}

describe("ConversationComputerParticipantInputDispatchAuthority", function _ParticipantInputDispatchSuite()
{
	it("issues the retained opaque input through the execution-fenced command authority", async function _DispatchesInput()
	{
		const subject = _Subject();

		await expect(subject.authority.dispatch({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1" })).resolves.toEqual({ dispatchedInputCount: 1 });

		expect(subject.commands.issueNextStartTurn).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", candidates: [{ inputEntryId: _INPUT_ID, inputPayloadRef: _PAYLOAD.payloadRef, inputPayloadDigest: _PAYLOAD.ciphertextDigest }] });
	});

	it("skips ordinary messages that do not activate the ConversationComputer", async function _SkipsOrdinaryMessage()
	{
		const subject = _Subject([{ ..._Input(), activation: "none" }]);
		subject.commands.issueNextStartTurn.mockResolvedValue({ command: null });

		await expect(subject.authority.dispatch({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1" })).resolves.toEqual({ dispatchedInputCount: 0 });

		expect(subject.commands.issueNextStartTurn).toHaveBeenCalledWith({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", candidates: [] });
	});

	it("rejects a retained start entry whose payload could not be redeemed by the runtime route", async function _RejectsMalformedPayload()
	{
		const subject = _Subject([{ ..._Input(), blocks: [{ id: "text", kind: "text", payloadRef: "payload://not-a-uuid", ciphertextDigest: _PAYLOAD.ciphertextDigest }] }]);

		await expect(subject.authority.dispatch({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1" })).rejects.toThrow("invalid retained payload");

		expect(subject.commands.issueNextStartTurn).not.toHaveBeenCalled();
	});

	it("rejects a start entry that does not carry the same idempotency and causation identifier", async function _RejectsMismatchedInput()
	{
		const subject = _Subject([{ ..._Input(), causationId: "different-cause" }]);

		await expect(subject.authority.dispatch({ siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1" })).rejects.toThrow("invalid retained input entry");

		expect(subject.commands.issueNextStartTurn).not.toHaveBeenCalled();
	});
});
