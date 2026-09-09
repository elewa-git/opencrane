import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ConversationModelToolModes } from "@opencrane/contracts";
import { KurrentConversationComputerTurnStore, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, type ConversationComputerContinuationReservation, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ToolHandoffSqlRuntime } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

const _First = new PrismaClient();
const _Second = new PrismaClient();
const _Runtimes = new Set<ReturnType<typeof _ToolHandoffSqlRuntime>>();
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", namespace: "computers", serviceAccountName: "computer", podUid: "computer-pod-1" };
const _AUDITED_WORKLOAD = { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: _WORKLOAD.namespace, serviceAccountName: _WORKLOAD.serviceAccountName, workloadKind: "pod", workloadUid: _WORKLOAD.podUid, podUid: _WORKLOAD.podUid } as const;

/** Bind the fixture request using the same public fields that the real turn store validates. */
function _RequestDigest(turn: FrozenConversationComputerTurn, reservation: Omit<ConversationComputerContinuationReservation, "requestDigest"> | { ordinal: 1; tools: ConversationModelToolModes; maxCompletionTokens: number; authorityExpiresAtEpochMs: number; dispatchDeadlineEpochMs: number }): string
{
	return ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, modelAlias: turn.modelAlias, ordinal: reservation.ordinal, tools: reservation.tools,
		continuation: reservation.ordinal === 2 ? reservation.continuation : null,
		proposalId: reservation.ordinal === 2 ? reservation.proposalId : null,
		resultDigest: reservation.ordinal === 2 ? reservation.resultDigest : null,
		maxCompletionTokens: reservation.maxCompletionTokens, authorityExpiresAtEpochMs: reservation.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: reservation.dispatchDeadlineEpochMs } as unknown as JsonValue);
}

/** Uses actual event validation with local history storage; this suite qualifies PostgreSQL, not KurrentDB. */
async function _TurnStore(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, invocation: { toolInvocationId: string; requestFingerprint: string }, payloadDigest: string, reserve: boolean)
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const history: Pick<HistoryStore, "append" | "readStream"> = {
		async append(command)
		{
			const events = streams.get(command.streamName) ?? [];
			const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? -1n : command.expectedRevision;
			if (expected !== BigInt(events.length - 1))
				throw new Error("SQL fixture history append conflicted");
			for (const event of command.events)
				events.push({ ...structuredClone(event), metadata: Object.fromEntries(Object.entries(event.metadata).map(([key, value]) => [key, String(value)])), streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date() });
			streams.set(command.streamName, events);
			return { streamName: command.streamName, revision: BigInt(events.length - 1) };
		},
		async *readStream(request)
		{
			for (const event of (streams.get(request.streamName) ?? []).filter(event => event.revision >= (request.fromRevision ?? 0n)).slice(0, request.maxCount)) yield structuredClone(event);
		},
	};
	const store = new KurrentConversationComputerTurnStore(history);
	let turn = await store.createOrRead(fixture.turn);
	const originalDeadline = fixture.candidate.compiledInput.budget.wallClockDeadlineEpochMs;
	if (originalDeadline === null)
		throw new Error("SQL fixture requires its original run deadline");
	const authorityExpiresAtEpochMs = Math.min(originalDeadline, Date.parse(fixture.candidate.credentialExpiresAt));
	const first = { ordinal: 1 as const, tools: ConversationModelToolModes.Select, maxCompletionTokens: 128, authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: Math.min(authorityExpiresAtEpochMs, Date.now() + 25_000) };
	await store.reserveModel(turn.bootstrapId, { ...first, compiledInputDigest: turn.compile.digest, invocationFence: randomUUID(), requestDigest: _RequestDigest(turn, first) });
	await store.selectTool(turn.bootstrapId, { proposalId: invocation.toolInvocationId, requestFingerprint: invocation.requestFingerprint, payloadRef: randomUUID(), ciphertextDigest: payloadDigest });
	turn = (await store.load(turn.bootstrapId))!;
	const second = { ordinal: 2 as const, tools: ConversationModelToolModes.None, compiledInputDigest: turn.compile.digest, maxCompletionTokens: 128, authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: Math.min(authorityExpiresAtEpochMs, Date.now() + 25_000), invocationFence: randomUUID(),
		continuation: { payloadRef: randomUUID(), ciphertextDigest: payloadDigest }, proposalId: invocation.toolInvocationId, resultDigest: payloadDigest };
	const reservation: ConversationComputerContinuationReservation = { ...second, requestDigest: _RequestDigest(turn, second) };
	if (reserve)
		await store.reserveContinuation(turn.bootstrapId, reservation);
	return { store, turn: (await store.load(turn.bootstrapId))!, reservation };
}

/** Complete a real fenced MCP claim through its IAM participant without invoking a provider. */
async function _Completed(reserve = true)
{
	const fixture = await _SeedConversationToolProposalSqlFixture();
	const runtime = _ToolHandoffSqlRuntime(_First, fixture);
	_Runtimes.add(runtime);
	await new PrismaConversationToolProposalUnitOfWork(_First, fixture.dependencies, runtime.admission).admit(fixture.turn, fixture.candidate, fixture.proposal, _AUDITED_WORKLOAD);
	const registered = (await runtime.register())!;
	const command = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
	if (command === null || typeof command === "string" || command.kind !== "invocation")
		throw new Error("Expected the real fenced invocation claim");
	const result = { isError: false, content: [{ type: "text", text: "Dedicated SQL result for this invocation" }] };
	expect(await runtime.authority.completeCompanion(registered.identity, { executionReference: registered.executionReference, podUid: registered.identity.podUid, executionId: command.executionId, claimFence: command.claimFence, completion: { kind: command.kind, result } })).toBe("completed");
	const invocation = await _Second.toolInvocation.findFirstOrThrow({ where: { runId: fixture.runId } });
	const delivery = await _Second.toolResultDelivery.findUniqueOrThrow({ where: { toolInvocationId: invocation.id } });
	expect(invocation).toMatchObject({ state: "Succeeded", result, claimKind: null, claimExpiresAt: null });
	expect(delivery.payload).toEqual({ toolInvocationId: invocation.toolInvocationId, outcome: "succeeded", result });
	expect(delivery.payloadDigest).toBe(___DigestCanonicalJson(delivery.payload as JsonValue));
	return { fixture, invocation, delivery, ...await _TurnStore(fixture, invocation, delivery.payloadDigest, reserve) };
}

/** Retain real authority composition; only the already-TokenReviewed Pod binding is a fixed test port. */
function _Owner(client: PrismaClient, f: Awaited<ReturnType<typeof _Completed>>)
{
	return new PrismaConversationToolResultsUnitOfWork(client, f.fixture.siloId, f.store, { async admit(command)
	{
		expect(command).toEqual({ computerId: f.turn.computerId, lease: f.turn.lease, workload: _WORKLOAD });
	} }, f.fixture.dependencies);
}

/** Let both independent transactions read the pending delivery before either acknowledges it. */
function _ConcurrentReaders()
{
	let arrived = 0;
	let release!: () => void;
	const barrier = new Promise<void>(resolve => { release = resolve; });
	const extension = Prisma.defineExtension({ query: { toolInvocation: { async findFirst({ args, query })
	{
		const row = await query(args);
		if (args.include?.resultDelivery && arrived < 2)
		{
			if (++arrived === 2)
				release();
			await barrier;
		}
		return row;
	} } } });
	return [_First.$extends(extension), _Second.$extends(extension)].map(client => client as unknown as PrismaClient);
}

describe("exact conversation result acknowledgement on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The result SQL proof requires the fresh database baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterEach(async function _FinishControllers() { for (const runtime of _Runtimes) await runtime.register(); _Runtimes.clear(); });
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("reads a real completed invocation without acknowledging or changing its payload", async function _Read()
	{
		const f = await _Completed(false);
		await expect(_Owner(_Second, f).read(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: "available", payload: f.delivery.payload, payloadDigest: f.delivery.payloadDigest });
		expect(await _First.toolResultDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } })).toEqual(f.delivery);
	});

	it("converges two independent consumers on one immutable payload and first acknowledgement time", async function _Race()
	{
		const f = await _Completed();
		const results = await Promise.all(_ConcurrentReaders().map(client => _Owner(client, f).consume(f.turn, _WORKLOAD)));
		for (const result of results) expect(result).toMatchObject({ outcome: "available", payload: f.delivery.payload, payloadDigest: f.delivery.payloadDigest });
		const consumed = await _Second.toolResultDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } });
		expect(consumed).toMatchObject({ state: "Consumed", payload: f.delivery.payload, payloadDigest: f.delivery.payloadDigest });
		expect(consumed.consumedAt).not.toBeNull();
		await expect(_Owner(_First, f).consume(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: "available" });
		expect(await _Second.toolResultDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } })).toEqual(consumed);
		expect(await _Second.toolInvocation.findUniqueOrThrow({ where: { id: f.invocation.id } })).toEqual(f.invocation);
	});

	it("does not consume before a matching second-call reservation exists in the real turn store", async function _NoSavedReservation()
	{
		const f = await _Completed(false);
		await expect(_Owner(_First, f).consume({ ...f.turn, continuationReservation: f.reservation }, _WORKLOAD)).resolves.toEqual({ outcome: "unavailable" });
		expect(await _Second.toolResultDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } })).toEqual(f.delivery);
	});

	it("refuses current grant revocation without acknowledging or changing the result", async function _Revocation()
	{
		const f = await _Completed();
		await _Second.authorizationGrant.update({ where: { id: f.fixture.toolGrantId }, data: { revokedAt: new Date() } });
		await expect(_Owner(_First, f).consume(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: "unavailable" });
		await expect(_Owner(_Second, f).read(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: "unavailable" });
		expect(await _Second.toolResultDelivery.findUniqueOrThrow({ where: { id: f.delivery.id } })).toEqual(f.delivery);
	});
});
