import { createHash } from "node:crypto";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { _ConversationComputerActiveTurnStreamName } from "../../lifecycle/conversation-computer-activity";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, type ConversationComputerStopAdmission } from "../conversation-computer-stop.types";
import { KurrentConversationComputerStopPublisher } from "../kurrent-conversation-computer-stop-publisher";

const _BOOTSTRAP = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _COMMAND = { commandId: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", generation: 1, causationId: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651", causationPosition: "2", requester: { principalId: "principal-1", subjectId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z" } } as const;
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _ACTIVE_STREAM = _ConversationComputerActiveTurnStreamName({ siloId: "testv5", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1 } });

function _ReceiptId(): string
{
	const hex = createHash("sha256").update(`stop-receipt:${_COMMAND.commandId}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function _SelectionId(): string
{
	const hex = createHash("sha256").update(`stop-selection:${_COMMAND.commandId}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function _Event(streamName: string, revision: bigint, id: string, type: string, data: Record<string, unknown>, metadata: Record<string, unknown> = {}): HistoryRecordedEvent
{
	return { streamName, revision, id, type, data, metadata, recordedAt: new Date("2026-09-11T08:00:00.000Z") };
}

const _FROZEN = _Event(`conversation-computer-turn-${_BOOTSTRAP}`, 0n, _BOOTSTRAP, "opencrane.conversation-computer-turn-frozen.v1", { turn: { bootstrapId: _BOOTSTRAP, siloId: "testv5", computerId: "computer-1", generation: 1, leaseId: "lease-1", sandboxClaimId: "computer-1-g1", binding: { siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: "1", maximumEntryBytes: 65_536 }, latestPendingEntryId: "message-1", latestPendingEntryPosition: "1", modelAlias: "model-1", maximumBudgetUsd: 0.05, credentialLifetimeSeconds: 300, compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "computer-v1", digest: _DIGEST } } });
const _ACTIVE = _Event(_ACTIVE_STREAM, 0n, _BOOTSTRAP, "opencrane.conversation-computer-turn-active.v1", { bootstrapId: _BOOTSTRAP, siloId: "testv5", computerId: "computer-1", generation: 1, leaseId: "lease-1" });

function _Target(): Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>
{
	const target = { bootstrapId: _BOOTSTRAP, runId: "run-1", attempt: 1, leaseId: "lease-1", leaseGeneration: 1 };
	const originalTurnTask = { taskId: "turn-task-1", taskName: "conversation-computer-turn", idempotencyKey: _BOOTSTRAP };
	return { kind: ConversationComputerStopAdmissionKinds.Target, command: _COMMAND, commandDigest: ___DigestCanonicalJson({ command: _COMMAND, target, originalTurnTask } as unknown as JsonValue), target, originalTurnTask, cancellationTask: { taskId: "stop-task-1", taskName: "conversation-computer-stop", idempotencyKey: _COMMAND.commandId }, requestedAt: "2026-09-11T08:00:00.000Z", authorizationDecisionDigest: _DIGEST };
}

function _TargetSelection()
{
	const admission = _Target();
	return { kind: admission.kind, command: admission.command, commandDigest: admission.commandDigest, target: admission.target, originalTurnTask: admission.originalTurnTask, activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "0", authorizationDecisionDigest: admission.authorizationDecisionDigest } as const;
}

const _SELECTION = _Event(`conversation-computer-stop-${_COMMAND.commandId}`, 0n, _SelectionId(), "opencrane.conversation-computer-stop-selection.v1", { selection: _TargetSelection() });

describe("KurrentConversationComputerStopPublisher", function _Suite()
{
	it("commits cancellation, receipt, safe log and active settlement under one checked turn head", async function _CancellationWinner()
	{
		const appendAtomic = vi.fn().mockResolvedValue([]);
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn(async function _Head(streamName: string) { return { streamName, revision: streamName.startsWith("conversation-") && !streamName.startsWith("conversation-computer-") ? 2n : 0n }; }), readStream: vi.fn(function _Read(request: { streamName: string }) { return (async function* _Events()
		{
			if (request.streamName === _FROZEN.streamName)
				yield _FROZEN;
			if (request.streamName === _ACTIVE_STREAM)
				yield _ACTIVE;
			if (request.streamName === _SELECTION.streamName)
				yield _SELECTION;
		})(); }) };
		const publisher = new KurrentConversationComputerStopPublisher(history);

		await expect(publisher.publish(_Target())).resolves.toEqual({ decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
		const atomic = appendAtomic.mock.calls[0]![0];
		expect(atomic.expectedHeads).toEqual(expect.arrayContaining([{ streamName: _FROZEN.streamName, revision: 0n }, { streamName: _ACTIVE_STREAM, revision: 0n }]));
		expect(atomic.appends.map((item: { streamName: string }) => item.streamName)).toEqual(expect.arrayContaining([_FROZEN.streamName, _ACTIVE_STREAM, "conversation-conversation-1", `conversation-computer-stop-${_COMMAND.commandId}`]));
		const serialized = JSON.stringify(atomic, function _BigInt(_key, value) { return typeof value === "bigint" ? value.toString() : value; });
		expect(serialized).not.toContain("credential");
		expect(serialized).not.toContain("compiledInput");
		expect(atomic.appends.find((item: { streamName: string }) => item.streamName === "conversation-conversation-1").events[0].data.entry).toMatchObject({ logKind: "run", phase: "interrupted", summary: "Work stopped" });
	});

	it("returns stale when the checked no-target pointer changed and no receipt won", async function _NoTargetConflict()
	{
		const appendAtomic = vi.fn().mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: _ACTIVE_STREAM, expected: 0n, current: 1n }));
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn(), readStream: vi.fn(() => (async function* _Empty() {})()) };
		const publisher = new KurrentConversationComputerStopPublisher(history);
		const commandDigest = ___DigestCanonicalJson({ command: _COMMAND, activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "0" } as unknown as JsonValue);
		const admission: ConversationComputerStopAdmission = { kind: ConversationComputerStopAdmissionKinds.NoTarget, command: _COMMAND, commandDigest, authorizationDecisionDigest: _DIGEST, activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "0" };

		await expect(publisher.publish(admission)).resolves.toEqual({ decision: ConversationComputerStopDecisions.Stale, published: false, outputReceiptDigest: null });
		expect(appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: expect.arrayContaining([{ streamName: _ACTIVE_STREAM, revision: 0n }, { streamName: `conversation-computer-stop-${_COMMAND.commandId}`, revision: HistoryExpectedRevisions.NoStream }]) }));
	});

	it("rejects a malformed durable receipt before treating it as a terminal decision", async function _MalformedReceipt()
	{
		const receipt = _Event(`conversation-computer-stop-${_COMMAND.commandId}`, 0n, _ReceiptId(), "opencrane.conversation-computer-stop-receipt.v1", { admission: { command: _COMMAND }, outcome: { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null } });
		const history = { append: vi.fn(), appendAtomic: vi.fn(), readHead: vi.fn(), readStream: vi.fn(() => (async function* _Receipt() { yield receipt; })()) };

		await expect(new KurrentConversationComputerStopPublisher(history).recover(_COMMAND)).rejects.toThrow();
	});

	it("rejects a durable decision that does not match its admitted target", async function _MismatchedReceipt()
	{
		const receipt = _Event(`conversation-computer-stop-${_COMMAND.commandId}`, 0n, _ReceiptId(), "opencrane.conversation-computer-stop-receipt.v1", { admission: _Target(), outcome: { decision: ConversationComputerStopDecisions.NoTarget, published: true, outputReceiptDigest: null } });
		const history = { append: vi.fn(), appendAtomic: vi.fn(), readHead: vi.fn(), readStream: vi.fn(() => (async function* _Receipt() { yield receipt; })()) };

		await expect(new KurrentConversationComputerStopPublisher(history).recover(_COMMAND)).rejects.toThrow("Stop receipt outcome differs from its admission");
	});

	it("rejects a durable receipt whose command digest does not bind its admitted target", async function _WrongDigest()
	{
		const admission = { ..._Target(), commandDigest: _DIGEST };
		const receipt = _Event(`conversation-computer-stop-${_COMMAND.commandId}`, 0n, _ReceiptId(), "opencrane.conversation-computer-stop-receipt.v1", { admission, outcome: { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null } });
		const history = { append: vi.fn(), appendAtomic: vi.fn(), readHead: vi.fn(), readStream: vi.fn(() => (async function* _Receipt() { yield receipt; })()) };

		await expect(new KurrentConversationComputerStopPublisher(history).recover(_COMMAND)).rejects.toThrow("Stop receipt command digest differs from its admission");
	});

	it("retries the same admitted target after an intermediate turn revision wins", async function _TargetContention()
	{
		const appendAtomic = vi.fn().mockRejectedValueOnce(new WrongExpectedVersionError(undefined, { streamName: _FROZEN.streamName, expected: 0n, current: 1n })).mockResolvedValue([]);
		let turnHeadRead = 0;
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn(async function _Head(streamName: string)
		{
			if (streamName === _FROZEN.streamName)
				return { streamName, revision: BigInt(turnHeadRead++) };
			return { streamName, revision: streamName === "conversation-conversation-1" ? 2n : 0n };
		}), readStream: vi.fn(function _Read(request: { streamName: string }) { return (async function* _Events()
		{
			if (request.streamName === _FROZEN.streamName)
				yield _FROZEN;
			if (request.streamName === _ACTIVE_STREAM)
				yield _ACTIVE;
			if (request.streamName === _SELECTION.streamName)
				yield _SELECTION;
		})(); }) };

		await expect(new KurrentConversationComputerStopPublisher(history).publish(_Target())).resolves.toEqual({ decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
		expect(appendAtomic).toHaveBeenCalledTimes(2);
		expect(appendAtomic.mock.calls[1]![0].expectedHeads).toContainEqual({ streamName: _FROZEN.streamName, revision: 1n });
	});

	it("recovers one target selection when a competing no-target delivery loses the command fence", async function _TargetBeatsNoTarget()
	{
		const appendAtomic = vi.fn().mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: _SELECTION.streamName, expected: HistoryExpectedRevisions.NoStream, current: 0n }));
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn(), readStream: vi.fn(function _Read(request: { streamName: string }) { return (async function* _Events()
		{
			if (request.streamName === _SELECTION.streamName)
				yield _SELECTION;
		})(); }) };
		const publisher = new KurrentConversationComputerStopPublisher(history);
		const noTarget = { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest: ___DigestCanonicalJson({ command: _COMMAND, activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "1" } as unknown as JsonValue), activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "1", authorizationDecisionDigest: _DIGEST } as const;

		await expect(publisher.select(_COMMAND, noTarget)).resolves.toEqual(_TargetSelection());
	});

	it("recovers no-target when a previously observed target loses the command fence", async function _NoTargetBeatsTarget()
	{
		const noTarget = { kind: ConversationComputerStopAdmissionKinds.NoTarget, command: _COMMAND, commandDigest: ___DigestCanonicalJson({ command: _COMMAND, activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "1" } as unknown as JsonValue), activeTurnStreamName: _ACTIVE_STREAM, activeTurnExpectedRevision: "1", authorizationDecisionDigest: _DIGEST } as const;
		const receipt = _Event(_SELECTION.streamName, 0n, _ReceiptId(), "opencrane.conversation-computer-stop-receipt.v1", { admission: noTarget, outcome: { decision: ConversationComputerStopDecisions.NoTarget, published: true, outputReceiptDigest: null } });
		const appendAtomic = vi.fn().mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: _SELECTION.streamName, expected: HistoryExpectedRevisions.NoStream, current: 0n }));
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn(), readStream: vi.fn(function _Read(request: { streamName: string }) { return (async function* _Events()
		{
			if (request.streamName === receipt.streamName)
				yield receipt;
		})(); }) };

		await expect(new KurrentConversationComputerStopPublisher(history).select(_COMMAND, _TargetSelection())).resolves.toEqual(noTarget);
	});

	it("retries a target when output won but its durable Stop receipt lost contention", async function _OutputReceiptContention()
	{
		const appendAtomic = vi.fn().mockRejectedValue(new WrongExpectedVersionError(undefined, { streamName: _FROZEN.streamName, expected: 1n, current: 2n }));
		const history = { append: vi.fn(), appendAtomic, readHead: vi.fn().mockResolvedValue({ streamName: _FROZEN.streamName, revision: 1n }), readStream: vi.fn(() => (async function* _Empty() {})()) };
		const publisher = new KurrentConversationComputerStopPublisher(history);
		const record = publisher as unknown as { _recordOutputWinner(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, outputReceiptDigest: string): Promise<unknown> };

		await expect(record._recordOutputWinner(_Target(), _DIGEST)).rejects.toThrow("Conversation Stop output winner receipt remained contended");
	});
});
