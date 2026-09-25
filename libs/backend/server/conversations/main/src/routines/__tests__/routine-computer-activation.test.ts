import type { Prisma } from "@prisma/client";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import type { RoutineOccurrenceActivationRepository, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryRecordedEvent, type HistoryReadRequest, type HistoryStore, type HistoryStreamHead } from "@opencrane/backend/server/infra/history-store";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { describe, expect, it, vi } from "vitest";

import { RoutineComputerActivation } from "../routine-computer-activation";
import { PrismaRoutineComputerActivationProjectionUnitOfWork } from "../prisma-routine-computer-activation-projection";
import { _RoutinePreparationReceipt } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";

const _PROFILE_REVISION = `sha256:${"a".repeat(64)}`;
const _PROFILE = { profileRevisionId: _PROFILE_REVISION, profileName: "developer", warmPoolName: "developer-pool", namespace: "computers", leaseTtlMilliseconds: 3_600_000 };
const _COMMAND: RoutineOccurrenceCommand = {
	siloId: "silo-1", firingId: "firing-1", routineId: "routine-1", routineRevision: 2,
	task: { taskId: "task-1", taskName: "routine-occurrence", idempotencyKey: "firing-1" }, admittedRunId: null,
	trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z", conversationId: "conversation-1",
	destinationConversationId: "destination-1", selectedManagedServiceId: "service-1", requesterPrincipalId: "principal-1",
	requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z", audiencePrincipalIds: ["principal-1"],
};
const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId,
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: _COMMAND.routineId, routineRevision: _COMMAND.routineRevision, firingId: _COMMAND.firingId, destinationConversationId: _COMMAND.destinationConversationId, trigger: _COMMAND.trigger, scheduledSlot: _COMMAND.scheduledSlot },
	agentServiceId: _COMMAND.selectedManagedServiceId, requesterPrincipalId: _COMMAND.requesterPrincipalId, requesterIssuer: _COMMAND.requesterIssuer, requesterSubjectId: _COMMAND.requesterSubjectId, requesterAuthenticatedAt: _COMMAND.requesterAuthenticatedAt,
	task: _COMMAND.task, audiencePrincipalIds: [..._COMMAND.audiencePrincipalIds], computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION,
	createdAt: "2026-09-25T10:00:01.000Z", payloadRef: "conversation-private://payload-1", ciphertextDigest: `sha256:${"b".repeat(64)}`,
};

/** Keeps computer history in revision order while applying the same expected-head fence as KurrentDB. */
class _MemoryHistoryStore implements Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	/** Stores each stream's immutable recorded events. */
	public readonly streams = new Map<string, HistoryRecordedEvent[]>();

	/** Reads a snapshot of the requested stream. */
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		for (const event of [...(this.streams.get(request.streamName) ?? [])])
			yield event;
	}

	/** Reports the current stream head. */
	public async readHead(streamName: string): Promise<HistoryStreamHead>
	{
		const events = this.streams.get(streamName) ?? [];
		return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) };
	}

	/** Appends at the expected revision and returns the checked head receipt. */
	public async append(command: HistoryAppend): Promise<HistoryAppendReceipt>
	{
		const events = this.streams.get(command.streamName) ?? [];
		const head = events.length === 0 ? null : BigInt(events.length - 1);
		const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? null : command.expectedRevision;
		if (expected !== head)
			throw new Error("WrongExpectedVersion");
		for (const event of command.events)
			events.push({ ...event, streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date("2026-09-25T10:00:02.000Z") });
		this.streams.set(command.streamName, events);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	}
}

/** Builds the real adapter around history, projection delegates and a scheduling authority seam. */
function _Fixture(overrides: { readonly profile?: typeof _PROFILE; readonly record?: RoutineOccurrenceHistoryRecord | null } = {})
{
	const history = new _MemoryHistoryStore();
	const computerHistory = new ConversationComputerHistory(history);
	const record = overrides.record === undefined ? _RECORD : overrides.record;
	const refused = { value: false };
	const authority = { value: true };
	const savedActivation: { value: Record<string, unknown> | null } = { value: null };
	const recordFailure: { value: Error | null } = { value: null };
	const loseCommitAcknowledgement = { value: false };
	const conversation = { computerAgentIdentityId: _RECORD.agentIdentityId, computerProfileRevisionId: _RECORD.profileRevisionId };
	const activeLease = { value: null as Record<string, unknown> | null };
	const claims = { claim: vi.fn() };
	const routines: RoutineOccurrenceActivationRepository = {
		authorize: vi.fn(async function _Authorize()
		{
			if (refused.value || !authority.value)
			{
				refused.value = true;
				return null;
			}
			return { activation: savedActivation.value as never };
		}),
		record: vi.fn(async function _Record(_command, _preparation, receipt)
		{
			if (recordFailure.value !== null)
			{
				throw recordFailure.value;
			}
			savedActivation.value = receipt;
			return receipt;
		}),
		refuse: vi.fn(async function _Refuse() { refused.value = true; }),
	};
	const transaction = {
		conversation: { findFirst: vi.fn(async function _FindConversation() { return conversation; }) },
		conversationComputerActiveLease: {
			upsert: vi.fn(async function _Upsert({ create }: { readonly create: Record<string, unknown> })
			{
				if (activeLease.value === null)
				{
					activeLease.value = create;
				}
				return activeLease.value;
			}),
			findUnique: vi.fn(async function _FindLease() { return activeLease.value === null ? null : { ...activeLease.value, expiresAt: new Date(activeLease.value.expiresAt as string) }; }),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>)
	{
		const before = { refused: refused.value, savedActivation: savedActivation.value, activeLease: activeLease.value };
		let result: unknown;
		try
		{
			result = await work(transaction as unknown as Prisma.TransactionClient);
		}
		catch (error)
		{
			refused.value = before.refused;
			savedActivation.value = before.savedActivation;
			activeLease.value = before.activeLease;
			throw error;
		}
		const publishedNow = before.savedActivation === null && savedActivation.value !== null;
		if (loseCommitAcknowledgement.value && publishedNow)
		{
			loseCommitAcknowledgement.value = false;
			throw new Error("routine activation transaction acknowledgement was lost");
		}
		return result;
	}) };
	const occurrences = { readRecord: vi.fn(async function _ReadRecord() { return record; }) };
	const unexpectedWorkflowAccess = vi.fn();
	const dependencyValues = { projections: function _Projections(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt, activationRecord: RoutineOccurrenceHistoryRecord) { return new PrismaRoutineComputerActivationProjectionUnitOfWork(prisma as never, function _Routines() { return routines; }, command, preparation, activationRecord, computerHistory); }, occurrences, history, claims, profile: overrides.profile ?? _PROFILE };
	const dependencies = new Proxy(dependencyValues, { get: function _ReadDependency(target, property, receiver)
	{
		if (property === "workflow" || property === "taskAdmission")
		{
			unexpectedWorkflowAccess(property);
			throw new Error("routine activation cannot access workflow task admission");
		}
		return Reflect.get(target, property, receiver);
	} });
	return { adapter: new RoutineComputerActivation(dependencies), history, computerHistory, claims, routines, occurrences, authority, refused, savedActivation, recordFailure, loseCommitAcknowledgement, activeLease, unexpectedWorkflowAccess, transaction, prisma };
}

/** Seeds the prepared occurrence's cold computer in the real computer history authority. */
async function _SeedCold(fixture: ReturnType<typeof _Fixture>): Promise<void>
{
	await fixture.computerHistory.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: "0a1b2c3d-0000-5000-8000-000000000001", computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: _RECORD.createdAt }, lease: null });
}

/** Seeds a cold computer with a changed generation to test the immutable occurrence fence. */
async function _SeedChangedGeneration(fixture: ReturnType<typeof _Fixture>): Promise<void>
{
	await fixture.computerHistory.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: "0a1b2c3d-0000-5000-8000-000000000002", computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 2, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: _RECORD.createdAt }, lease: null });
}

/** Advances the prepared computer to an expired generation-one claim without calling SandboxClaim. */
async function _SeedExpiredClaim(fixture: ReturnType<typeof _Fixture>): Promise<void>
{
	await _SeedCold(fixture);
	await fixture.computerHistory.append({
		expectedRevision: 0n,
		eventId: "0a1b2c3d-0000-5000-8000-000000000003",
		computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.ClaimPending, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: "2026-09-25T10:00:02.000Z" },
		lease: { schemaVersion: 1, id: "lease-expired", computerId: _RECORD.computerId, generation: 1, sandboxClaimId: "computer-1-g1", sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, claimedAt: "2026-09-25T10:00:02.000Z", expiresAt: "2026-09-25T10:00:03.000Z", releasedAt: null },
	});
}

/** Seeds a generation-one lease whose lifecycle ended before activation could finish. */
async function _SeedEndedLease(fixture: ReturnType<typeof _Fixture>, state: ComputerLeaseStates.Released | ComputerLeaseStates.Lost): Promise<void>
{
	await fixture.computerHistory.append({
		expectedRevision: HistoryExpectedRevisions.NoStream,
		eventId: state === ComputerLeaseStates.Released ? "0a1b2c3d-0000-5000-8000-000000000004" : "0a1b2c3d-0000-5000-8000-000000000005",
		computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: "2026-09-25T10:00:03.000Z" },
		lease: { schemaVersion: 1, id: `lease-${state}`, computerId: _RECORD.computerId, generation: 1, sandboxClaimId: "computer-1-g1", sandboxId: null, serviceFQDN: null, state, claimedAt: "2026-09-25T10:00:01.000Z", expiresAt: "2026-09-25T11:00:01.000Z", releasedAt: "2026-09-25T10:00:03.000Z" },
	});
}

/** Seeds a retired prepared computer that cannot admit another lease. */
async function _SeedRetired(fixture: ReturnType<typeof _Fixture>): Promise<void>
{
	await fixture.computerHistory.append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: "0a1b2c3d-0000-5000-8000-000000000006", computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.Retired, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: "2026-09-25T10:00:03.000Z" }, lease: null });
}

describe("PrismaRoutineComputerActivation", function _Suite()
{
	it("moves one cold computer through pending to active and recovers the saved receipt", async function _ActivatesAndReplays()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.claims.claim.mockResolvedValueOnce({ claimId: "computer-1-g1", outcome: "created", sandboxId: null, serviceFQDN: null }).mockResolvedValueOnce({ claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" });
		const preparation = _RoutinePreparationReceipt(_RECORD);

		await expect(fixture.adapter.activate(_COMMAND, preparation)).resolves.toMatchObject({ status: "pending" });
		await expect(fixture.adapter.activate(_COMMAND, preparation)).resolves.toMatchObject({ status: "active", receipt: expect.any(Object) });
		await expect(fixture.adapter.activate(_COMMAND, preparation)).resolves.toMatchObject({ status: "active", receipt: fixture.savedActivation.value });
		expect(fixture.claims.claim).toHaveBeenCalledTimes(2);
		expect(fixture.routines.record).toHaveBeenCalledTimes(2);
		fixture.savedActivation.value = { ...fixture.savedActivation.value!, digest: `sha256:${"f".repeat(64)}` };
		await expect(fixture.adapter.activate(_COMMAND, preparation)).rejects.toThrow(/receipt|activation/iu);
		expect(fixture.claims.claim).toHaveBeenCalledTimes(2);
	});

	it("commits a current-authority refusal before claiming", async function _RefusesAuthority()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.authority.value = false;
		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
	});

	it("commits a profile-parking refusal before claiming", async function _RefusesProfile()
	{
		const fixture = _Fixture({ profile: { ..._PROFILE, profileRevisionId: "sha256:wrong" } });
		await _SeedCold(fixture);
		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
	});

	it("fails closed for missing or substituted prepared history and generation", async function _RejectsEvidence()
	{
		const missing = _Fixture({ record: null });
		await expect(missing.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("prepared occurrence history");
		const wrongGeneration = _Fixture();
		await _SeedCold(wrongGeneration);
		wrongGeneration.occurrences.readRecord.mockResolvedValue({ ..._RECORD, computerId: "computer-2" });
		await expect(wrongGeneration.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("command or preparation differs");
	});

	it("does not admit a task before activation publishes its receipt", async function _NoEarlyTask()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.claims.claim.mockResolvedValue({ claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" });
		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toMatchObject({ status: "active" });
		expect(fixture.routines.record).toHaveBeenCalledOnce();
		expect(fixture.savedActivation.value).not.toBeNull();
		expect(fixture.unexpectedWorkflowAccess).not.toHaveBeenCalled();
	});

	it("rolls back both the SQL lease and activation receipt when record fails", async function _RollsBackPublication()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.claims.claim.mockResolvedValue({ claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" });
		fixture.recordFailure.value = new Error("activation receipt write failed");

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("activation receipt write failed");
		expect(fixture.activeLease.value).toBeNull();
		expect(fixture.savedActivation.value).toBeNull();

		fixture.recordFailure.value = null;
		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toMatchObject({ status: "active" });
		expect(fixture.claims.claim).toHaveBeenCalledOnce();
		expect(fixture.activeLease.value).not.toBeNull();
		expect(fixture.savedActivation.value).not.toBeNull();
	});

	it("recovers the same claim and receipt after the committed SQL acknowledgement is lost", async function _LostCommitAcknowledgement()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.claims.claim.mockResolvedValue({ claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" });
		fixture.loseCommitAcknowledgement.value = true;

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("acknowledgement was lost");
		const committedReceipt = fixture.savedActivation.value;
		expect(committedReceipt).not.toBeNull();
		expect(fixture.activeLease.value).not.toBeNull();

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "active", receipt: committedReceipt });
		expect(fixture.claims.claim).toHaveBeenCalledOnce();
		expect(fixture.routines.record).toHaveBeenCalledTimes(2);
		expect(fixture.savedActivation.value).toEqual(committedReceipt);
	});

	it("commits refusal when current authority is revoked after assignment but before publication", async function _RevokedBeforePublication()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.claims.claim.mockImplementation(async function _AssignedThenRevoked()
		{
			fixture.authority.value = false;
			return { claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" };
		});

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.activeLease.value).toBeNull();
		expect(fixture.savedActivation.value).toBeNull();
		expect(fixture.claims.claim).toHaveBeenCalledOnce();
	});

	it("refuses an expired pending lease before requesting another claim", async function _ExpiredPendingLease()
	{
		const fixture = _Fixture();
		await _SeedExpiredClaim(fixture);

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
		expect(fixture.activeLease.value).toBeNull();
		expect(fixture.savedActivation.value).toBeNull();
	});

	it("refuses a saved activation whose lease ended before run admission", async function _SavedActivationEndedLease()
	{
		const fixture = _Fixture();
		await _SeedEndedLease(fixture, ComputerLeaseStates.Lost);
		fixture.savedActivation.value = { receiptId: "activation-receipt-1", computerReference: "{}", digest: `sha256:${"c".repeat(64)}` };

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
	});

	it("refuses a retired prepared computer before requesting a claim", async function _RetiredBeforeClaim()
	{
		const fixture = _Fixture();
		await _SeedRetired(fixture);

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
	});

	it.each([ComputerLeaseStates.Released, ComputerLeaseStates.Lost] as const)("refuses a generation-one %s lease before requesting another claim", async function _EndedLease(state)
	{
		const fixture = _Fixture();
		await _SeedEndedLease(fixture, state);

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).resolves.toEqual({ status: "refused" });
		expect(fixture.refused.value).toBe(true);
		expect(fixture.claims.claim).not.toHaveBeenCalled();
	});

	it("rejects an actual change to the prepared computer generation", async function _ChangedGeneration()
	{
		const fixture = _Fixture();
		await _SeedChangedGeneration(fixture);

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("computer generation differs");
		expect(fixture.claims.claim).not.toHaveBeenCalled();
		expect(fixture.refused.value).toBe(false);
	});

	it("rejects a conflicting relational lease projection without saving a receipt", async function _ProjectionTampering()
	{
		const fixture = _Fixture();
		await _SeedCold(fixture);
		fixture.activeLease.value = { siloId: _COMMAND.siloId, conversationId: _COMMAND.conversationId, computerId: _RECORD.computerId, agentIdentityId: _RECORD.agentIdentityId, leaseId: "lease-tampered", leaseGeneration: 1, expiresAt: new Date("2099-09-25T10:00:00.000Z") };
		fixture.claims.claim.mockResolvedValue({ claimId: "computer-1-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" });

		await expect(fixture.adapter.activate(_COMMAND, _RoutinePreparationReceipt(_RECORD))).rejects.toThrow("projection conflicts with current authority");
		expect(fixture.savedActivation.value).toBeNull();
		expect(fixture.routines.record).not.toHaveBeenCalled();
		expect(fixture.activeLease.value).toMatchObject({ leaseId: "lease-tampered" });
	});
});
