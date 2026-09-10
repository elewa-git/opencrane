import { describe, expect, it, vi } from "vitest";

import type { BoundConversationWriterAppend } from "@opencrane/backend/server/conversations/history";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ConversationComputerToolResultOutcomes } from "../conversation-computer-continuation.types";
import { ConversationComputerTurnWriterFactory } from "../conversation-computer-turn-writer-factory";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { _ModelReservationFixture } from "./conversation-output-intent.fixture";

const _TURN: FrozenConversationComputerTurn = {
	bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1",
	lease: { leaseId: "lease-1", leaseGeneration: 4, sandboxClaimId: "computer-1-g4" },
	binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 4, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Archive", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 7n, maximumEntryBytes: 10_000 },
	latestPendingEntryId: "human-entry-1", modelAlias: "model-1", maximumBudgetUsd: 1, credentialLifetimeSeconds: 300,
	latestPendingEntryPosition: "1",
	compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "v1", digest: "sha256:input" },
	outputSourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", outputReceipt: null,
	toolSelection: null, continuationReservation: null, modelReservation: null,
};
const _WORKLOAD = { subject: "system:serviceaccount:testv5:computer", namespace: "testv5", serviceAccountName: "computer", podUid: "pod-1" };
const _COMMAND: BoundConversationWriterAppend = { sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:payload" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: "source-1", correlationId: "request-1" } };

/** Retain the accepted event so the real writer can confirm its exact physical append. */
function _Fixture(turn = _TURN)
{
	let accepted: HistoryRecordedEvent | null = null;
	const append = vi.fn(async function _Append(command)
	{
		accepted = { ...command.events[0], streamName: command.streamName, revision: 8n };
		return { streamName: command.streamName, revision: 8n };
	});
	const history = { append, readStream: async function* _ReadStream()
	{
		if (accepted !== null)
			yield accepted;
	} };
	const load = vi.fn().mockResolvedValue(turn);
	const assertCurrent = vi.fn().mockResolvedValue({ credentialExpiresAt: "2099-01-01T00:00:00Z" });
	const read = vi.fn().mockResolvedValue({ outcome: ConversationComputerToolResultOutcomes.Available, payloadDigest: "sha256:result", notAfterEpochMs: Date.parse("2099-01-01T00:00:00Z") });
	const factory = new ConversationComputerTurnWriterFactory(history, { load }, { assertCurrent }, { read });
	return { append, load, assertCurrent, read, writer: factory.create(turn, _WORKLOAD) };
}

/** Bind the answer to the result consumed by the saved final model reservation. */
function _ToolTurn(): FrozenConversationComputerTurn
{
	const reference = { payloadRef: "tool-declaration", ciphertextDigest: "sha256:declaration" };
	const model = _ModelReservationFixture(_TURN, "first-model-fence");
	return {
		..._TURN,
		modelReservation: model,
		toolSelection: { ...reference, proposalId: "proposal-1", requestFingerprint: "sha256:proposal" },
		continuationReservation: { ...model, ordinal: 2, continuation: reference, proposalId: "proposal-1", resultDigest: "sha256:result" },
	};
}

describe("conversation computer output policy", function _Suite()
{
	it("checks the admitted output and current workload lease before appending to its bound stream", async function _Allowed()
	{
		const { writer, append, load, assertCurrent, read } = _Fixture();
		const intent = await writer.prepare(_COMMAND);
		await writer.append(intent);
		expect(load).toHaveBeenCalledWith(_TURN.bootstrapId);
		expect(assertCurrent).toHaveBeenCalledWith(_TURN, _WORKLOAD);
		expect(read).not.toHaveBeenCalled();
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ streamName: "conversation-conversation-1", expectedRevision: 7n }));
	});

	it.each([null, { ..._TURN, outputSourceCommandId: "other-output" }])("refuses missing or conflicting admitted output", async function _Conflict(current)
	{
		const { writer, append, load } = _Fixture();
		load.mockResolvedValue(current);
		await expect(writer.prepare(_COMMAND)).rejects.toThrow("conflicting output");
		expect(append).not.toHaveBeenCalled();
	});

	it("refuses output redirected to a private audience", async function _Audience()
	{
		const { writer, append } = _Fixture();
		await expect(writer.prepare({ ..._COMMAND, entry: { ..._COMMAND.entry, visibility: { audience: "participant_subset", participantIds: ["user-1"] } } })).rejects.toThrow("conversation visibility");
		expect(append).not.toHaveBeenCalled();
	});

	it("refuses output after the workload lease changes", async function _StaleLease()
	{
		const { writer, append, assertCurrent } = _Fixture();
		const intent = await writer.prepare(_COMMAND);
		assertCurrent.mockRejectedValue(new Error("lease replaced"));
		await expect(writer.append(intent)).rejects.toThrow("lease replaced");
		expect(append).not.toHaveBeenCalled();
	});

	it.each([
		{ outcome: ConversationComputerToolResultOutcomes.Unavailable },
		{ outcome: ConversationComputerToolResultOutcomes.Pending },
		{ outcome: ConversationComputerToolResultOutcomes.Available, payloadDigest: "sha256:substituted", notAfterEpochMs: Date.parse("2099-01-01T00:00:00Z") },
		{ outcome: ConversationComputerToolResultOutcomes.Available, payloadDigest: "sha256:result", notAfterEpochMs: 1 },
	])("refuses a new physical append when the selected result loses authority or changes", async function _RefusedResult(result)
	{
		const { writer, append, read } = _Fixture(_ToolTurn());
		const intent = await writer.prepare(_COMMAND);
		read.mockResolvedValue(result);
		await expect(writer.append(intent)).rejects.toThrow(/authority/);
		expect(append).not.toHaveBeenCalled();
	});

	it("checks the original result and its current deadline before appending a tool-based answer", async function _AllowedResult()
	{
		const turn = _ToolTurn();
		const { writer, append, read } = _Fixture(turn);
		const intent = await writer.prepare(_COMMAND);
		await writer.append(intent);
		expect(read).toHaveBeenCalledWith(turn, _WORKLOAD);
		expect(append).toHaveBeenCalledOnce();
	});
});
