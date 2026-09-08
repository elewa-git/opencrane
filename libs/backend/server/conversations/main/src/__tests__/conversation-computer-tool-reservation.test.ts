import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { ConversationToolProposalOutcomes } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { ConversationComputerTurnAuthority } from "../conversation-computer-turn-authority";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { ConversationComputerTurnCandidate, ConversationComputerTurnAuthorityDependencies } from "../conversation-computer-turn.types";
import { _PrepareConversationToolProposal } from "../conversation-tool-proposal";
import { ConversationToolProposalRefusal } from "../conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals } from "../conversation-tool-proposal.types";

/** Model expected revisions and event-ID retry acknowledgements across independent store instances. */
class _MemoryHistory implements Pick<HistoryStore, "append" | "readStream">
{
	public readonly streams = new Map<string, HistoryRecordedEvent[]>();
	public beforeAppend: (command: HistoryAppend) => Promise<void> = async () => undefined;
	public afterAppend: (command: HistoryAppend) => Promise<void> = async () => undefined;
	public failDecisionRead = false;
	public async append(command: HistoryAppend): Promise<HistoryAppendReceipt>
	{
		await this.beforeAppend(command);
		const events = this.streams.get(command.streamName) ?? [];
		const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? -1n : command.expectedRevision;
		const current = BigInt(events.length - 1);
		if (expected !== current)
		{
			if (events[Number(expected + 1n)]?.id === command.events[0].id)
				return { streamName: command.streamName, revision: current };
			throw new WrongExpectedVersionError(undefined, { streamName: command.streamName, expected, current });
		}
		for (const event of command.events)
			events.push({ ...event, data: structuredClone(event.data), metadata: structuredClone(event.metadata), streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date() });
		this.streams.set(command.streamName, events);
		await this.afterAppend(command);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	}
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		const events = this.streams.get(request.streamName) ?? [];
		if (this.failDecisionRead && request.streamName.startsWith("conversation-computer-turn-") && events.length > 1)
		{
			this.failDecisionRead = false;
			throw new Error("decision read unavailable");
		}
		yield* events;
	}
}

function _Gate()
{
	let release!: () => void;
	const promise = new Promise<void>(resolve => { release = resolve; });
	return { promise, release };
}

async function _Harness()
{
	const history = new _MemoryHistory();
	const schema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } };
	const binding = { siloId: "silo", conversationId: "conversation", computerId: "computer", leaseGeneration: 1, agentIdentityId: "identity", agentServiceId: "service", agentName: "Assistant", agentAvatarArtifactRevisionId: null, runId: "run", expectedRevision: 5n, maximumEntryBytes: 65_536 };
	const candidate: ConversationComputerTurnCandidate = { binding, latestPendingEntryId: "human-entry", modelAlias: "test-model", maximumBudgetUsd: 1, credentialLifetimeSeconds: 60, credentialExpiresAt: "2099-01-01T00:00:00.000Z", lease: { leaseId: "lease", leaseGeneration: 1, sandboxClaimId: "computer-g1" }, compiledInput: { promptCompilerVersion: "test-v1", runId: "run", attempt: 1, instructions: "Help", messages: [], digest: `sha256:${"a".repeat(64)}`, tools: [{ name: "records.read", toolRevisionId: "tool-1", description: "Read", requiresApproval: false, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }], model: { modelAlias: "test-model", maxOutputTokens: 100, generatedOutputCapabilities: [] }, budget: { maxCompletionTokens: 200, maxModelTurns: 2, maxToolInvocations: 1, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000 } } };
	const rows = new Set<string>();
	const admission = vi.fn<ConversationComputerTurnAuthorityDependencies["toolProposals"]["admit"]>(async (turn, current, proposal) =>
	{
		const prepared = _PrepareConversationToolProposal(turn, current, proposal);
		const outcome = rows.has(prepared.proposalId) ? ConversationToolProposalOutcomes.Existing : ConversationToolProposalOutcomes.Recorded;
		rows.add(prepared.proposalId);
		return { proposalId: prepared.proposalId, outcome };
	});
	const writer = vi.fn().mockResolvedValue({});
	const dependencies = { siloId: "silo", endpoint: "http://model.test", candidates: { admit: vi.fn(), resolve: vi.fn().mockResolvedValue(candidate), assertCurrent: vi.fn().mockResolvedValue(candidate) }, store: new KurrentConversationComputerTurnStore(history), toolProposals: { admit: admission }, reviewCredentials: { derive: vi.fn(), bearer: vi.fn() }, credentials: { issueOrRotate: vi.fn().mockResolvedValue({ key: "test-only", credentialDigest: "sha256:test" }), revoke: vi.fn() }, outputPayloads: { store: vi.fn().mockResolvedValue({ blockId: "block", payloadRef: "opaque-payload", ciphertextDigest: "sha256:ciphertext" }) }, runLifecycle: { start: vi.fn(), complete: vi.fn() }, writers: { create: vi.fn(() => ({ append: writer })) } };
	const restart = () => new ConversationComputerTurnAuthority({ ...dependencies, store: new KurrentConversationComputerTurnStore(history) });
	const authority = restart();
	const workload = { subject: "system:serviceaccount:silo:computer", namespace: "silo", serviceAccountName: "computer", podUid: "pod" };
	const command = { computerId: "computer", lease: candidate.lease, workload };
	const bootstrap = await authority.bootstrap(command);
	const proposal = { bootstrapId: bootstrap!.bootstrapId, toolRevisionId: "tool-1", arguments: { query: "private record" }, workload };
	const output = { bootstrapId: bootstrap!.bootstrapId, sourceCommandId: "59f3e83d-5526-4dfc-a6d5-6c6d2d7509ee", text: "Finished", workload };
	const stream = `conversation-computer-turn-${bootstrap!.bootstrapId}`;
	return { history, authority, restart, dependencies, admission, writer, rows, candidate, command, proposal, output, stream };
}

describe("one durable decision between a tool proposal and final output", function _Suite()
{
	it("refuses SQL admission when final output wins the first reservation race", async function _OutputWins()
	{
		const f = await _Harness();
		const entered = _Gate();
		const proceed = _Gate();
		f.history.beforeAppend = async command =>
		{
			if (command.events[0].type.endsWith("tool-reserved.v1"))
			{
				entered.release();
				await proceed.promise;
			}
		};
		const proposed = f.authority.proposeTool(f.proposal);
		const rejected = expect(proposed).rejects.toThrow("denied");
		await entered.promise;
		await expect(f.restart().appendOutput(f.output)).resolves.toBe("accepted");
		proceed.release();
		await rejected;
		expect(f.admission).not.toHaveBeenCalled();
		expect(f.writer).toHaveBeenCalledTimes(1);
	});

	it("never finishes output when a reservation wins after output preparation", async function _ToolWins()
	{
		const f = await _Harness();
		const entered = _Gate();
		const proceed = _Gate();
		f.history.beforeAppend = async command =>
		{
			if (command.events[0].type.endsWith("turn-output.v1"))
			{
				entered.release();
				await proceed.promise;
			}
		};
		const output = f.authority.appendOutput(f.output);
		const rejected = expect(output).rejects.toThrow("output decision");
		await entered.promise;
		await f.restart().proposeTool(f.proposal);
		proceed.release();
		await rejected;
		expect(f.writer).not.toHaveBeenCalled();
		expect(f.dependencies.runLifecycle.complete).not.toHaveBeenCalled();
		expect(f.dependencies.credentials.revoke).not.toHaveBeenCalled();
		expect(await f.dependencies.store.loadActive({ siloId: "silo", ...f.command })).not.toBeNull();
	});

	it("recovers one exact reservation across concurrent retries and preserves the frozen input", async function _Retry()
	{
		const f = await _Harness();
		const before = await f.dependencies.store.load(f.proposal.bootstrapId);
		const receipts = await Promise.all([f.authority.proposeTool(f.proposal), f.restart().proposeTool(f.proposal)]);
		expect(new Set(receipts.map(receipt => receipt.proposalId)).size).toBe(1);
		expect(f.rows.size).toBe(1);
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
		const after = await f.dependencies.store.load(f.proposal.bootstrapId);
		expect(after?.compile).toEqual(before?.compile);
		expect(after?.binding.expectedRevision).toBe(5n);
		expect(JSON.stringify(f.history.streams.get(f.stream)?.[1].data)).not.toContain("private record");
		await expect(f.restart().proposeTool({ ...f.proposal, arguments: { query: "another record" } })).rejects.toThrow("conflict");
		expect(f.admission).toHaveBeenCalledTimes(2);
	});

	it("retries a reservation response loss without issuing another model credential", async function _ReservationResponseLoss()
	{
		const f = await _Harness();
		f.history.afterAppend = async command =>
		{
			if (command.events[0].type.endsWith("tool-reserved.v1"))
			{
				f.history.afterAppend = async () => undefined;
				throw new Error("reservation response lost");
			}
		};
		await expect(f.authority.proposeTool(f.proposal)).rejects.toThrow("response lost");
		expect(f.admission).not.toHaveBeenCalled();
		await expect(f.restart().bootstrap(f.command)).resolves.toBeNull();
		expect(f.dependencies.credentials.issueOrRotate).toHaveBeenCalledTimes(1);
		await expect(f.restart().proposeTool(f.proposal)).resolves.toMatchObject({ outcome: "recorded" });
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});

	it.each([ConversationToolProposalRefusals.Invalid, ConversationToolProposalRefusals.Denied, ConversationToolProposalRefusals.Conflict, "database unavailable"])("keeps reserved work after admission returns %s", async function _Sticky(error)
	{
		const f = await _Harness();
		f.admission.mockRejectedValue(new Error(error));
		await expect(f.authority.proposeTool(f.proposal)).rejects.toThrow(error);
		expect((await f.dependencies.store.load(f.proposal.bootstrapId))?.toolReservation).not.toBeNull();
		await expect(f.restart().appendOutput(f.output)).rejects.toThrow("unresolved tool work");
		expect(f.writer).not.toHaveBeenCalled();
	});

	it("keeps a committed proposal after response loss and a later current-authority refusal", async function _CommitResponseLoss()
	{
		const f = await _Harness();
		const admitted = f.admission.getMockImplementation()!;
		f.admission.mockImplementationOnce(async (...args) => { await admitted(...args); throw new Error("commit response lost"); });
		await expect(f.authority.proposeTool(f.proposal)).rejects.toThrow("commit response lost");
		f.admission.mockRejectedValueOnce(new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied));
		await expect(f.restart().proposeTool(f.proposal)).rejects.toThrow("denied");
		await expect(f.restart().appendOutput(f.output)).rejects.toThrow("unresolved tool work");
		await expect(f.restart().proposeTool(f.proposal)).resolves.toMatchObject({ outcome: "existing" });
		expect(f.rows.size).toBe(1);
	});

	it("does not reserve schema-invalid arguments or erase an earlier valid reservation", async function _InvalidArguments()
	{
		const f = await _Harness();
		await expect(f.authority.proposeTool({ ...f.proposal, arguments: {} })).rejects.toThrow("invalid");
		expect(f.history.streams.get(f.stream)).toHaveLength(1);
		await f.authority.proposeTool(f.proposal);
		await expect(f.restart().proposeTool({ ...f.proposal, arguments: {} })).rejects.toThrow("invalid");
		expect(f.history.streams.get(f.stream)).toHaveLength(2);
	});

	it("requires decision readback even after an acknowledged reservation", async function _UnavailableReadback()
	{
		const f = await _Harness();
		f.history.afterAppend = async command =>
		{
			if (command.events[0].type.endsWith("tool-reserved.v1"))
				f.history.failDecisionRead = true;
		};
		await expect(f.authority.proposeTool(f.proposal)).rejects.toThrow("decision read unavailable");
		expect(f.admission).not.toHaveBeenCalled();
		f.history.afterAppend = async () => undefined;
		await f.restart().proposeTool(f.proposal);
		expect(f.rows.size).toBe(1);
	});

	it("refuses a successful same-ID append acknowledgement for a different stored decision", async function _EventAlias()
	{
		const f = await _Harness();
		await f.authority.proposeTool(f.proposal);
		const reserved = f.history.streams.get(f.stream)![1];
		const receipt = { sourceCommandId: reserved.id, blockId: "block", payloadRef: "opaque-payload", ciphertextDigest: "sha256:ciphertext" };
		await expect(f.dependencies.store.markOutput(f.proposal.bootstrapId, receipt)).rejects.toThrow("output decision");
		expect(f.history.streams.get(f.stream)![1].type).toContain("tool-reserved");
		expect(f.writer).not.toHaveBeenCalled();
	});

	it("refuses SQL when a same-ID acknowledgement retains an output decision", async function _ReservationAlias()
	{
		const f = await _Harness();
		f.history.beforeAppend = async command =>
		{
			if (!command.events[0].type.endsWith("tool-reserved.v1"))
				return;
			const sourceCommandId = command.events[0].id;
			f.history.streams.get(f.stream)!.push({ id: sourceCommandId, type: "opencrane.conversation-computer-turn-output.v1", streamName: f.stream, revision: 1n, recordedAt: new Date(), data: { bootstrapId: f.proposal.bootstrapId, sourceCommandId, blockId: "block", payloadRef: "payload", ciphertextDigest: "sha256:cipher" }, metadata: { bootstrapId: f.proposal.bootstrapId } });
		};
		await expect(f.authority.proposeTool(f.proposal)).rejects.toThrow("denied");
		expect(f.admission).not.toHaveBeenCalled();
	});

	it("keeps output closed when one admission denies while an identical admission is unresolved", async function _ConcurrentDenial()
	{
		const f = await _Harness();
		const entered = _Gate();
		const proceed = _Gate();
		const admitted = f.admission.getMockImplementation()!;
		f.admission.mockImplementationOnce(async (...args) => { entered.release(); await proceed.promise; return admitted(...args); });
		f.admission.mockRejectedValueOnce(new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied));
		const first = f.authority.proposeTool(f.proposal);
		await entered.promise;
		await expect(f.restart().proposeTool(f.proposal)).rejects.toThrow("denied");
		await expect(f.restart().appendOutput(f.output)).rejects.toThrow("unresolved tool work");
		proceed.release();
		await first;
		expect(f.rows.size).toBe(1);
		expect(f.writer).not.toHaveBeenCalled();
	});

	it("compares every output receipt field after event-ID replay acknowledgement", async function _ChangedReceipt()
	{
		const f = await _Harness();
		const receipt = { sourceCommandId: f.output.sourceCommandId, blockId: "block", payloadRef: "opaque-payload", ciphertextDigest: "sha256:ciphertext" };
		await f.dependencies.store.markOutput(f.proposal.bootstrapId, receipt);
		await expect(f.dependencies.store.markOutput(f.proposal.bootstrapId, { ...receipt, payloadRef: "other-payload" })).rejects.toThrow("output decision");
	});

	it.each(["fingerprint", "bootstrap", "metadata", "event-id", "unknown", "extra-event"])("rejects malformed or mixed stored decisions: %s", async function _Malformed(kind)
	{
		const f = await _Harness();
		await f.authority.proposeTool(f.proposal);
		const events = f.history.streams.get(f.stream)!;
		const event = events[1];
		if (kind === "fingerprint")
			events[1] = { ...event, data: { ...event.data, requestFingerprint: "invalid" } };
		if (kind === "bootstrap")
			events[1] = { ...event, data: { ...event.data, bootstrapId: "foreign" } };
		if (kind === "metadata")
			events[1] = { ...event, metadata: { bootstrapId: "foreign" } };
		if (kind === "event-id")
			events[1] = { ...event, id: f.output.sourceCommandId };
		if (kind === "unknown")
			events[1] = { ...event, type: "unknown.v1" };
		if (kind === "extra-event")
			events.push({ ...event, revision: 2n });
		await expect(f.restart().proposeTool(f.proposal)).rejects.toThrow();
		expect(f.admission).toHaveBeenCalledTimes(1);
	});
});
