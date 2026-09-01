import { ConversationEntryKinds, type ConversationEntry } from "@opencrane/contracts";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import type { ConversationHistoryReader } from "../../conversation-history-reader";
import type { ConversationComputerHistory } from "../conversation-computer-history";
import { ConversationComputerRuntimeOutputAuthority } from "../conversation-computer-runtime-output-authority";
import type { ConversationComputerRuntimeOutputAuthorityDependencies } from "../conversation-computer-runtime-output-authority.types";

/** Fixes the command identity shared by the output authority's retry and atomicity tests. */
const _COMMAND_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Captures the deterministic output UUID derived from the command without reusing its input UUID. */
const _OUTPUT_ID = "8c69a1ab-6253-5349-85f4-1a6ec1d764f2";
/** Keeps server-stamped entry times deterministic in every output authority test. */
const _NOW = new Date("2026-09-01T00:10:00.000Z");
/** Reuses the opaque payload coordinates that private storage returns to the authority. */
const _PAYLOAD = { payloadRef: "payload://output-1" as const, ciphertextDigest: `sha256:${"b".repeat(64)}` as const };

/** Builds the runtime-safe output command that the authenticated route will supply. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", commandId: _COMMAND_ID, executionId: "execution-1", leaseGeneration: 2, profileRevisionId: "profile-1", text: "The isolated runtime reply", ...overrides };
}

/** Builds one checked active execution whose identity is stamped onto every accepted output. */
function _Active()
{
	return {
		streamName: "conversation-computer-computer-1",
		revision: 4n,
		computer: { id: "computer-1", agentIdentityId: "identity-1" },
		lease: { generation: 2 },
		execution: { id: "execution-1" },
	};
}

/** Builds a durable output entry used to prove response-lost retry handling. */
function _ExistingOutput(): ConversationEntry
{
	return {
		schemaVersion: 1,
		id: _OUTPUT_ID,
		conversationId: "conversation-1",
		position: "7",
		author: { kind: "agent", agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Archive", avatarArtifactRevisionId: null },
		provenance: "agent-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: _COMMAND_ID,
		correlationId: "execution-1",
		idempotencyKey: _OUTPUT_ID,
		occurredAt: _NOW.toISOString(),
		attestation: null,
		kind: ConversationEntryKinds.Message,
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: _PAYLOAD.payloadRef, ciphertextDigest: _PAYLOAD.ciphertextDigest }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "none",
	};
}

/** Builds the initiating input entry whose UUID must remain distinct from its command output. */
function _InputEntry(): ConversationEntry
{
	return { ..._ExistingOutput(), id: _COMMAND_ID, idempotencyKey: _COMMAND_ID, causationId: "participant-input-1", correlationId: "participant-request-1" };
}

/** Builds narrow port doubles while retaining every observed atomic condition for assertions. */
function _Subject(overrides: { readonly entries?: readonly ConversationEntry[]; readonly conversationRevision?: bigint | HistoryExpectedRevisions; readonly active?: ReturnType<typeof _Active> } = {})
{
	const history = { appendAtomic: vi.fn().mockResolvedValue([]) };
	const computers = { loadActiveExecutionForRuntime: vi.fn().mockResolvedValue(overrides.active ?? _Active()) };
	const identities = { loadActiveAuthorization: vi.fn().mockResolvedValue({ identity: { id: "identity-1", name: "Archive", avatarArtifactRevisionId: null }, agentServiceId: "service-1", expectedIdentityHeads: [{ streamName: "agent-identity-identity-1", revision: 3n }] }) };
	const conversations = { readCurrent: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", expectedRevision: overrides.conversationRevision ?? 7n, entries: overrides.entries ?? [] }) };
	const claims = { prepareOutputClaim: vi.fn().mockResolvedValue({ expectedHead: { streamName: "conversation-computer-runtime-computer-1-execution-1", revision: 5n }, append: { streamName: "conversation-computer-runtime-computer-1-execution-1", expectedRevision: 5n, events: [{ id: "5bf0d6c2-5215-4cdb-a29f-e3735195b8f7", type: "opencrane.conversation-computer-runtime-command-output-recorded.v1", data: { commandId: _COMMAND_ID }, metadata: { computerId: "computer-1", executionId: "execution-1", leaseGeneration: 2, commandId: _COMMAND_ID } }] } }) };
	const payloads = { storeText: vi.fn().mockResolvedValue(_PAYLOAD) };
	const dependencies = {
		history,
		computers: computers as Pick<ConversationComputerHistory, "loadActiveExecutionForRuntime">,
		identities: identities as Pick<AgentIdentityHistory, "loadActiveAuthorization">,
		conversations: conversations as Pick<ConversationHistoryReader, "readCurrent">,
		claims,
		payloads,
		clock: { now: function _Now(): Date { return _NOW; } },
	} satisfies ConversationComputerRuntimeOutputAuthorityDependencies;
	const authority = new ConversationComputerRuntimeOutputAuthority(dependencies);
	return { authority, history, computers, identities, conversations, claims, payloads };
}

describe("ConversationComputerRuntimeOutputAuthority", function _RuntimeOutputAuthoritySuite()
{
	it("atomically records the command success transition and the server-stamped opaque message", async function _RecordsAtomicOutput()
	{
		const subject = _Subject({ entries: [_InputEntry()] });

		await expect(subject.authority.record(_Command())).resolves.toEqual({ messageId: _OUTPUT_ID });

		expect(subject.claims.prepareOutputClaim).toHaveBeenCalledWith(expect.objectContaining({ commandId: _COMMAND_ID, executionId: "execution-1", leaseGeneration: 2 }));
		expect(subject.history.appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "conversation-computer-runtime-computer-1-execution-1", revision: 5n }, { streamName: "conversation-computer-computer-1", revision: 4n }, { streamName: "conversation-conversation-1", revision: 7n }, { streamName: "agent-identity-identity-1", revision: 3n }] }));
		const append = subject.history.appendAtomic.mock.calls[0][0];
		expect(append.appends[0]).toMatchObject({ streamName: "conversation-computer-runtime-computer-1-execution-1", events: [{ data: { commandId: _COMMAND_ID } }] });
		expect(append.appends[1].events[0].data.entry).toMatchObject({ id: _OUTPUT_ID, idempotencyKey: _OUTPUT_ID, position: "8", author: { kind: "agent", agentIdentityId: "identity-1", agentServiceId: "service-1" }, causationId: _COMMAND_ID, correlationId: "execution-1", blocks: [{ payloadRef: _PAYLOAD.payloadRef, ciphertextDigest: _PAYLOAD.ciphertextDigest }] });
		expect(append.appends[1].events[0].id).toBe(_OUTPUT_ID);
	});

	it("returns an exact durable response-lost winner without claiming or appending again", async function _ReplaysOutput()
	{
		const subject = _Subject({ entries: [_ExistingOutput()] });

		await expect(subject.authority.record(_Command())).resolves.toEqual({ messageId: _OUTPUT_ID });

		expect(subject.claims.prepareOutputClaim).not.toHaveBeenCalled();
		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
	});

	it("rejects a foreign execution before storing plaintext or preparing a claim", async function _RejectsForeignExecution()
	{
		const subject = _Subject();

		await expect(subject.authority.record(_Command({ executionId: "execution-2" }))).rejects.toThrow("foreign execution coordinates");

		expect(subject.payloads.storeText).not.toHaveBeenCalled();
		expect(subject.claims.prepareOutputClaim).not.toHaveBeenCalled();
	});

	it("rejects an unissued or non-head command before it can retain an opaque payload", async function _RejectsUnissuedCommand()
	{
		const subject = _Subject();
		subject.claims.prepareOutputClaim.mockRejectedValue(new Error("Conversation computer runtime output claim requires one pending unclaimed command"));

		await expect(subject.authority.record(_Command({ commandId: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651" }))).rejects.toThrow("pending unclaimed command");

		expect(subject.payloads.storeText).not.toHaveBeenCalled();
		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
	});

	it("uses the first conversation position when the checked stream is empty", async function _UsesFirstPosition()
	{
		const subject = _Subject({ conversationRevision: HistoryExpectedRevisions.NoStream });

		await subject.authority.record(_Command());

		expect(subject.history.appendAtomic.mock.calls[0][0].appends[1].events[0].data.entry.position).toBe("0");
	});
});
