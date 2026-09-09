import { __AssertConversationComputerAnswerAuthority } from "../conversation-computer-answer-authority";
import { _ReserveConversationOutputFixture } from "./conversation-output-intent.fixture";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { vi } from "vitest";

import { ConversationModelResponseKinds, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { BoundConversationWriter } from "../bound-conversation-writer";
import { ActiveConversationComputerTurnCandidateResolver } from "../conversation-computer-turn-candidate-resolver";
import { ConversationComputerTurnAuthority } from "../conversation-computer-turn-authority";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { ConversationComputerTurnCandidate, ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/** Model checked revisions, same-ID acknowledgements and bounded reads over shared durable records. */
class _History implements Pick<HistoryStore, "append" | "readStream">
{
	readonly streams = new Map<string, HistoryRecordedEvent[]>();
	beforeAppend: (command: HistoryAppend) => Promise<void> = async function _Before() {};
	afterAppend: (command: HistoryAppend) => Promise<void> = async function _After() {};
	beforeRead: (request: HistoryReadRequest) => Promise<void> = async function _Read() {};
	async append(command: HistoryAppend)
	{
		await this.beforeAppend(command);
		const events = this.streams.get(command.streamName) ?? [];
		if (!command.events.every(event => events.some(saved => saved.id === event.id)))
		{
			const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? -1n : command.expectedRevision;
			if (expected !== BigInt(events.length - 1))
				throw new WrongExpectedVersionError(undefined, { streamName: command.streamName, expected, current: BigInt(events.length - 1) });
			for (const event of command.events)
				events.push({ ...structuredClone(event), metadata: Object.fromEntries(Object.entries(event.metadata).map(([key, value]) => [key, String(value)])), streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date() });
			this.streams.set(command.streamName, events);
		}
		await this.afterAppend(command);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	}
	async *readStream(request: HistoryReadRequest)
	{
		await this.beforeRead(request);
		const events = (this.streams.get(request.streamName) ?? []).filter(event => event.revision >= (request.fromRevision ?? 0n)).slice(0, request.maxCount);
		for (const event of events)
			yield structuredClone(event);
	}
}

/** Recreate the actual store, writer, Pod/lease resolver and coordinator against shared durable state. */
export async function _OutputRecoveryHarness(reserveOutput = true, overrides: Partial<ConversationComputerTurnAuthorityDependencies> = {})
{
	const history = new _History();
	const stream = "conversation-conversation-1";
	history.streams.set(stream, [0n, 1n].map(revision => ({ id: `prior-${revision}`, type: "prior-entry", data: {}, metadata: {}, streamName: stream, revision, recordedAt: new Date() })));
	const binding = { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 };
	const lease = { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" };
	const candidate: ConversationComputerTurnCandidate = { binding, lease, latestPendingEntryId: "prior-1", modelAlias: "test-model", maximumBudgetUsd: 1, credentialLifetimeSeconds: 60, credentialExpiresAt: "2099-01-01T00:00:00.000Z", compiledInput: { promptCompilerVersion: "test-v1", runId: "run-1", attempt: 1, instructions: "Help", messages: [], tools: [], model: { modelAlias: "test-model", maxOutputTokens: 100, generatedOutputCapabilities: [] }, budget: { maxCompletionTokens: 100, maxModelTurns: 1, maxToolInvocations: 0, maxCostUsdMicros: null, wallClockDeadlineEpochMs: null }, digest: `sha256:${"a".repeat(64)}` } };
	const current = { computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: lease.leaseId, generation: 1, state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", expiresAt: "2099-01-01T00:00:00.000Z" } };
	const flags = { mayAppend: true, mayUseVisibility: true, stamp: 0, payloadWrites: 0, runState: "running" };
	const compiler = { compile: vi.fn(async function _CompileOriginalHistory()
	{
		return flags.mayAppend && history.streams.get(stream)!.at(-1)!.revision === binding.expectedRevision ? candidate : null;
	}) };
	const pods = { verify: vi.fn(async function _Verify(command: { workload: { podUid: string; namespace: string; serviceAccountName: string } }) { return command.workload.podUid === "pod-1" && command.workload.namespace === "computers" && command.workload.serviceAccountName === "computer"; }) };
	const candidates = new ActiveConversationComputerTurnCandidateResolver("silo-1", { resolve: async function _Projection() { return { conversationId: binding.conversationId, agentIdentityId: binding.agentIdentityId, profileRevisionId: "profile-1" }; } }, { load: async function _Computer() { return current; } } as never, pods, compiler);
	const payloads = new Map<string, { text: string; blockId: string; payloadRef: string; ciphertextDigest: string }>();
	const outputPayloads = { store: vi.fn(async function _Payload(_turn: FrozenConversationComputerTurn, source: string, text: string)
	{
		const existing = payloads.get(source);
		if (existing !== undefined && existing.text !== text)
			throw new Error("output idempotency key was reused for different text");
		if (existing === undefined)
		{
			flags.payloadWrites++;
			payloads.set(source, { text, blockId: "block-1", payloadRef: "payload-1", ciphertextDigest: "sha256:ciphertext" });
		}
		const saved = payloads.get(source)!;
		return { blockId: saved.blockId, payloadRef: saved.payloadRef, ciphertextDigest: saved.ciphertextDigest };
	}) };
	const model = { request: vi.fn().mockResolvedValue({ kind: ConversationModelResponseKinds.Text, text: "A private chosen answer" }) };
	const credentials = { issueOnce: vi.fn().mockResolvedValue({ key: "test-only-key", credentialDigest: `sha256:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" }), reuseExact: vi.fn().mockResolvedValue({ key: "test-only-key", credentialDigest: `sha256:${"d".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" }), revoke: vi.fn().mockResolvedValue(undefined) };
	const runLifecycle = { start: vi.fn().mockResolvedValue(undefined), complete: vi.fn(async function _Complete()
	{
		if (flags.runState === "failed")
			throw new Error("run is already failed");
		flags.runState = "completed";
	}) };
	function _Restart()
	{
		const store = new KurrentConversationComputerTurnStore(history);
		const dependencies: ConversationComputerTurnAuthorityDependencies = { logger: { warn: vi.fn() }, modelCustody: { loadDeclaration: vi.fn().mockResolvedValue(null), storeDeclaration: vi.fn(), loadContinuation: vi.fn(), storeContinuation: vi.fn() }, toolResults: { read: vi.fn(), consume: vi.fn() }, model, siloId: "silo-1", endpoint: "http://model.test", candidates, store, toolProposals: { admit: vi.fn() }, outputPayloads, credentials, runLifecycle, reviewCredentials: { derive: vi.fn(), bearer: vi.fn() }, writers: { create: function _Writer(turn, workload)
		{
			return new BoundConversationWriter(history, turn.binding, { now: function _Now() { return new Date(Date.parse("2026-09-08T23:00:00.000Z") + flags.stamp++ * 1_000); } }, { assertMayAppend: async function _Rate() {} }, { assertMayUseVisibility: async function _Visibility()
			{
				if (!flags.mayUseVisibility)
					throw new Error("visibility denied");
			} }, { assertMayAppend: async function _Fence() { await __AssertConversationComputerAnswerAuthority(turn, workload, { candidates, toolResults: overrides.toolResults ?? dependencies.toolResults }); } });
		} } };
		return new ConversationComputerTurnAuthority({ ...dependencies, ...overrides });
	}
	const command = { computerId: "computer-1", lease, workload: { subject: "system:serviceaccount:computers:computer", namespace: "computers", serviceAccountName: "computer", podUid: "pod-1" } };
	const authority = _Restart();
	const bootstrap = await authority.bootstrap(command);
	const output = { bootstrapId: bootstrap!.bootstrapId, sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", modelInvocationFence: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", modelNotAfterEpochMs: Date.parse("2099-01-01T00:00:00Z"), text: "A private chosen answer", workload: command.workload };
	if (reserveOutput)
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(history), bootstrap!.bootstrapId, output.sourceCommandId);
	return { candidate, model, history, stream, current, flags, compiler, pods, candidates, payloads, outputPayloads, credentials, runLifecycle, command, output, authority, restart: _Restart, store: new KurrentConversationComputerTurnStore(history) };
}
