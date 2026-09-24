import { randomUUID } from "node:crypto";

import { Absurd } from "absurd-sdk";
import pg from "pg";
import { ArtifactRevisionState, ArtifactScanJobState, ArtifactUploadLeaseState, ConversationAssetState, PrismaClient, type Prisma, type ConversationGeneratedFile } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ArtifactQuarantineOutcomes, PrismaArtifactQuarantineRepository, PrismaArtifactScanUnitOfWork, type QuarantineArtifactRevisionCommand } from "@opencrane/backend/server/agents/artifacts";
import { _RegisterConversationGeneratedFileWorkflow, PrismaConversationAssetScanRepository } from "@opencrane/backend/server/conversation-assets";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { ArtifactScannerVerdict, ___GeneratedFileEventName } from "@opencrane/contracts";

import { _ActualGeneratedFileScanner, _CaptureActualGeneratedFileSqlFixture, _ClaimActualGeneratedFile, _QuarantineActualGeneratedFile, type _ActualGeneratedFileCapture } from "./conversation-generated-file-lifecycle.sql-fixture";
import { _CaptureGeneratedFileSqlFixture, _FinishGeneratedFileSqlRuntimes, _GeneratedFileSqlDigest } from "./conversation-generated-file.sql-fixture";
import { _WaitPastSqlDeadline } from "./conversation-tool-handoff.sql-fixture";

/** Writer and recovery clients share only the committed PostgreSQL state. */
const _First = new PrismaClient();
/** Independent reader used after committed and rejected writes. */
const _Recovery = new PrismaClient();
/** Shared test-owned PostgreSQL pool used by real Absurd task and event admission. */
const _Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
/** Queue unique to this suite so both task wake records have independent durable evidence. */
const _Queue = `file-scan-${randomUUID()}`;
/** Synthetic mounted key used only to prove encrypted capture and replay. */
const _Cipher = AesGcmConversationPrivatePayloadCipher.fromDocument({ currentKeyId: "generated-file-scan-key", keys: { "generated-file-scan-key": Buffer.alloc(32, 11).toString("base64url") } });
/** Production workflow engine facade used for task and event admission without starting workers. */
let _Workflows: ReturnType<typeof _CreateAbsurdWorkflowEngine>;
/** SDK reader for committed task and event evidence in this suite's queue. */
let _QueueOwner: Absurd;

/** Exact publication command; file bytes and receipt generation are outside this database proof. */
function _Command(operation: ConversationGeneratedFile): QuarantineArtifactRevisionCommand
{
	return {
		siloId: operation.siloId, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId, createdBy: operation.requesterSubject,
		provenance: { kind: "conversation_generated_file", operationId: operation.id },
		promotion: { leaseId: operation.uploadLeaseId, contentAddress: operation.contentAddress, byteLength: Number(operation.byteLength), mediaType: operation.mediaType, receiptDigest: _GeneratedFileSqlDigest(`receipt:${operation.id}`) },
	};
}

/** Seed one structural capture and return its committed immutable operation. */
async function _Operation(): Promise<ConversationGeneratedFile>
{
	const capture = await _CaptureGeneratedFileSqlFixture(_First);
	return _First.conversationGeneratedFile.findUniqueOrThrow({ where: { id: capture.operationId } });
}

/** Build the exact proposed revision without admitting its receipt or scan. */
function _Revision(operation: ConversationGeneratedFile): Prisma.ArtifactRevisionUncheckedCreateInput
{
	return { id: operation.revisionId, artifactId: operation.artifactId, revision: 1, state: ArtifactRevisionState.Quarantined, contentAddress: operation.contentAddress, byteLength: operation.byteLength, mediaType: operation.mediaType, createdBy: operation.requesterSubject, provenance: { kind: "conversation_generated_file", operationId: operation.id } };
}

/** Record the receipt state that must precede quarantine insertion in the same transaction. */
async function _PromoteLease(transaction: Prisma.TransactionClient, operation: ConversationGeneratedFile): Promise<void>
{
	await transaction.artifactUploadLease.update({ where: { id: operation.uploadLeaseId }, data: { state: ArtifactUploadLeaseState.Promoted, promotedContentAddress: operation.contentAddress, promotedByteLength: operation.byteLength, promotionReceiptDigest: _Command(operation).promotion.receiptDigest, promotedAt: new Date() } });
}

/** Use the real quarantine repository and the same asset transition as the workflow owner. */
async function _Quarantine(operation: ConversationGeneratedFile): Promise<void>
{
	await _First.$transaction(async function _Admit(transaction)
	{
		const repository = new PrismaArtifactQuarantineRepository(transaction);
		expect(await repository.finalize(_Command(operation))).toBe(ArtifactQuarantineOutcomes.Accepted);
		await transaction.conversationAsset.update({ where: { id: operation.assetId }, data: { state: ConversationAssetState.Processing, revisionId: operation.revisionId } });
	});
}

/** Exercise the real scanner transaction and conversation lifecycle owner with no external scanner. */
function _Scanner(client: PrismaClient): PrismaArtifactScanUnitOfWork
{
	return new PrismaArtifactScanUnitOfWork(client, 60_000, function _Assets(transaction) { return new PrismaConversationAssetScanRepository(transaction); }, {
		async spawn() { throw new Error("CSV scanning must not admit PDF preprocessing"); },
	});
}

/** Seed the saved claim consumed by scanner completion; this does not run or qualify ClamAV. */
async function _Claim(operation: ConversationGeneratedFile)
{
	return _First.artifactScanJob.update({ where: { artifactRevisionId: operation.revisionId }, data: { state: ArtifactScanJobState.Claimed, attempt: 1, claimFence: randomUUID(), claimExpiresAt: new Date(Date.now() + 60_000) } });
}

/** Register the production generated-file task without starting its external promotion worker. */
function _CreateWorkflows()
{
	const workflows = _CreateAbsurdWorkflowEngine({ databaseUrl: process.env.DATABASE_URL!, databasePool: _Pool, databasePoolSize: 2, queueAuthority: { queueForTask: function _QueueForTask() { return _Queue; } } });
	_RegisterConversationGeneratedFileWorkflow(workflows, {
		persistence: {
			async loadCurrent() { throw new Error("Quarantine SQL proof drives persistence directly"); },
			async openVerifiedBytes() { throw new Error("Quarantine SQL proof never transfers file bytes"); },
			async finalizeQuarantine() { throw new Error("Quarantine SQL proof drives persistence directly"); },
		},
		promotion: { async promote() { throw new Error("Quarantine SQL proof never calls Artifact transport"); } },
	});
	return workflows;
}

/** Read both immutable task-scoped wake events from this suite's actual Absurd queue. */
async function _TerminalEvents(capture: _ActualGeneratedFileCapture): Promise<Map<string, unknown>>
{
	const operationEvent = `opencrane-task:${capture.operation.workflowTaskId}:event:${___GeneratedFileEventName(capture.operation.id)}`;
	const parentEvent = `opencrane-task:${capture.parentTaskReceipt.taskId}:event:${___GeneratedFileEventName(capture.operation.id)}`;
	const table = `absurd."e_${_Queue}"`;
	const result = await _Pool.query<{ readonly event_name: string; readonly payload: unknown }>(`SELECT event_name, payload FROM ${table} WHERE event_name = ANY($1::text[])`, [[operationEvent, parentEvent]]);
	return new Map(result.rows.map(row => [row.event_name, row.payload]));
}

/** Require one state-bearing generated-task event and one identifier-only parent wake. */
async function _ExpectTerminalEvents(capture: _ActualGeneratedFileCapture, state: "ready" | "failed"): Promise<void>
{
	const events = await _TerminalEvents(capture);
	const operationEvent = `opencrane-task:${capture.operation.workflowTaskId}:event:${___GeneratedFileEventName(capture.operation.id)}`;
	const parentEvent = `opencrane-task:${capture.parentTaskReceipt.taskId}:event:${___GeneratedFileEventName(capture.operation.id)}`;
	expect(events).toEqual(new Map([
		[operationEvent, { operationId: capture.operation.id, state }],
		[parentEvent, { operationId: capture.operation.id }],
	]));
}

describe("generated-file quarantine and scanner authority on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Quarantine SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Recovery.$connect()]);
		_QueueOwner = new Absurd({ db: _Pool, queueName: _Queue });
		await _QueueOwner.createQueue(_Queue);
		_Workflows = _CreateWorkflows();
	});
	afterEach(_FinishGeneratedFileSqlRuntimes);
	afterAll(async function _Disconnect()
	{
		await Promise.all([_First.$disconnect(), _Recovery.$disconnect()]);
		await _Workflows?.close();
		await _QueueOwner?.close();
		await _Pool.end();
	});

	it("recovers one quarantined revision and scan after a new database client", async function _QuarantineRecovery()
	{
		const capture = await _CaptureGeneratedFileSqlFixture(_First);
		const operation = await _First.conversationGeneratedFile.findUniqueOrThrow({ where: { id: capture.operationId } });
		const command = {
			siloId: operation.siloId, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId, createdBy: operation.requesterSubject,
			provenance: { kind: "conversation_generated_file", operationId: operation.id },
			promotion: { leaseId: operation.uploadLeaseId, contentAddress: operation.contentAddress, byteLength: Number(operation.byteLength), mediaType: operation.mediaType, receiptDigest: _GeneratedFileSqlDigest(`receipt:${operation.id}`) },
		};
		await expect(_First.$transaction(async function _Quarantine(transaction)
		{
			const repository = new PrismaArtifactQuarantineRepository(transaction);
			return repository.finalize(command);
		})).resolves.toBe(ArtifactQuarantineOutcomes.Accepted);
		await expect(_Recovery.$transaction(async function _Recover(transaction)
		{
			const repository = new PrismaArtifactQuarantineRepository(transaction);
			return repository.finalize(command);
		})).resolves.toBe(ArtifactQuarantineOutcomes.Idempotent);
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: operation.revisionId }, include: { artifact: true, scanJob: true } })).toMatchObject({ state: "Quarantined", artifact: { currentRevisionId: null }, scanJob: { artifactRevisionId: operation.revisionId, state: "Pending" } });
		expect(await _Recovery.artifactScanJob.count({ where: { artifactRevisionId: operation.revisionId } })).toBe(1);
	});

	it("rolls receipt consumption and scan admission back when the enclosing asset transaction fails", async function _QuarantineRollback()
	{
		const capture = await _CaptureGeneratedFileSqlFixture(_First);
		const operation = await _First.conversationGeneratedFile.findUniqueOrThrow({ where: { id: capture.operationId } });
		await expect(_First.$transaction(async function _FailAfterQuarantine(transaction)
		{
			const repository = new PrismaArtifactQuarantineRepository(transaction);
			const result = await repository.finalize({
				siloId: operation.siloId, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId, createdBy: operation.requesterSubject,
				provenance: { kind: "conversation_generated_file", operationId: operation.id },
				promotion: { leaseId: operation.uploadLeaseId, contentAddress: operation.contentAddress, byteLength: Number(operation.byteLength), mediaType: operation.mediaType, receiptDigest: _GeneratedFileSqlDigest(`rollback:${operation.id}`) },
			});
			expect(result).toBe(ArtifactQuarantineOutcomes.Accepted);
			throw new Error("asset transaction failed after scan admission");
		})).rejects.toThrow("asset transaction failed after scan admission");
		expect(await _Recovery.artifactRevision.count({ where: { id: operation.revisionId } })).toBe(0);
		expect(await _Recovery.artifactScanJob.count({ where: { artifactRevisionId: operation.revisionId } })).toBe(0);
		expect(await _Recovery.artifactUploadLease.findUniqueOrThrow({ where: { id: operation.uploadLeaseId } })).toMatchObject({ state: "Active", promotionReceiptDigest: null, finalizedAt: null });
	});
	it("rejects quarantine without a promoted receipt and rejects changed bytes", async function _RejectsUnbackedRevision()
	{
		const operation = await _Operation();
		await expect(_First.artifactRevision.create({ data: _Revision(operation) })).rejects.toThrow();
		await expect(_First.$transaction(async function _WrongContent(transaction)
		{
			await _PromoteLease(transaction, operation);
			await transaction.artifactRevision.create({ data: { ..._Revision(operation), contentAddress: _GeneratedFileSqlDigest("other bytes") } });
		})).rejects.toThrow();
		expect(await _Recovery.artifactRevision.count({ where: { id: operation.revisionId } })).toBe(0);
	});

	it("requires a pending scan before a quarantined insertion can commit", async function _RequiresScanAdmission()
	{
		const operation = await _Operation();
		await expect(_First.$transaction(async function _MissingScan(transaction)
		{
			await _PromoteLease(transaction, operation);
			await transaction.artifactRevision.create({ data: _Revision(operation) });
		})).rejects.toThrow();
		expect(await _Recovery.artifactRevision.count({ where: { id: operation.revisionId } })).toBe(0);
		expect(await _Recovery.artifactUploadLease.findUniqueOrThrow({ where: { id: operation.uploadLeaseId } })).toMatchObject({ state: ArtifactUploadLeaseState.Active });
	});

	it.each([ArtifactRevisionState.Published, ArtifactRevisionState.Rejected])("rejects direct quarantine transition to %s without a scanner verdict", async function _RejectsDirectTransition(state)
	{
		const operation = await _Operation();
		await _Quarantine(operation);
		await _Claim(operation);
		await expect(_First.artifactRevision.update({ where: { id: operation.revisionId }, data: { state } })).rejects.toThrow();
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: operation.revisionId } })).toMatchObject({ state: ArtifactRevisionState.Quarantined });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: operation.artifactId } })).toMatchObject({ currentRevisionId: null });
	});

	it("cannot manufacture a completed scan without first holding its current claim", async function _RejectsUnclaimedVerdict()
	{
		const operation = await _Operation();
		await _Quarantine(operation);
		await expect(_First.$transaction(async function _SkipClaim(transaction)
		{
			await transaction.artifactScanJob.update({ where: { artifactRevisionId: operation.revisionId }, data: { state: ArtifactScanJobState.Clean, scannerVersion: "synthetic-sql-verdict", completedAt: new Date() } });
			await transaction.artifactRevision.update({ where: { id: operation.revisionId }, data: { state: ArtifactRevisionState.Published } });
		})).rejects.toThrow();
		expect(await _Recovery.artifactScanJob.findUniqueOrThrow({ where: { artifactRevisionId: operation.revisionId } })).toMatchObject({ state: ArtifactScanJobState.Pending });
	});

	it.each([
		[ArtifactScannerVerdict.Clean, ArtifactRevisionState.Published, ConversationAssetState.Ready, null, "ready"],
		[ArtifactScannerVerdict.Rejected, ArtifactRevisionState.Rejected, ConversationAssetState.Failed, "unsafe_file", "failed"],
	] as const)("commits %s for an actually captured file and wakes both saved tasks", async function _CompletesActualScan(verdict, revisionState, assetState, failureCode, terminalState)
	{
		const capture = await _CaptureActualGeneratedFileSqlFixture(_First, _Workflows, _Cipher);
		await _QuarantineActualGeneratedFile(_First, capture);
		const job = await _ClaimActualGeneratedFile(_First, capture.operation);
		const command = { jobId: job.id, attempt: job.attempt, claimFence: job.claimFence!, verdict, scannerVersion: "synthetic-sql-verdict" };
		const first = _ActualGeneratedFileScanner(_First, capture);
		const recovery = _ActualGeneratedFileScanner(_Recovery, capture);
		await expect(first.complete(command)).resolves.toBe("completed");
		await expect(recovery.complete(command)).resolves.toBe("idempotent");
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: capture.operation.revisionId } })).toMatchObject({ state: revisionState });
		expect(await _Recovery.conversationAsset.findUniqueOrThrow({ where: { id: capture.operation.assetId } })).toMatchObject({ state: assetState, failureCode });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: capture.operation.artifactId } })).toMatchObject({ currentRevisionId: verdict === ArtifactScannerVerdict.Clean ? capture.operation.revisionId : null });
		expect(await _Recovery.artifactScanJob.count({ where: { artifactRevisionId: capture.operation.revisionId } })).toBe(1);
		await _ExpectTerminalEvents(capture, terminalState);
	});

	it("records a terminal scanner failure and wakes both actual task receipts", async function _TerminalScannerFailure()
	{
		const capture = await _CaptureActualGeneratedFileSqlFixture(_First, _Workflows, _Cipher);
		await _QuarantineActualGeneratedFile(_First, capture);
		const job = await _ClaimActualGeneratedFile(_First, capture.operation, 3);
		const scanner = _ActualGeneratedFileScanner(_First, capture);
		await expect(scanner.fail({ jobId: job.id, attempt: job.attempt, claimFence: job.claimFence!, failureCode: "scanner_failed" })).resolves.toBe("failed");
		expect(await _Recovery.artifactScanJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ state: ArtifactScanJobState.TerminalFailed, failureCode: "scanner_failed", claimFence: null });
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: capture.operation.revisionId } })).toMatchObject({ state: ArtifactRevisionState.Quarantined });
		expect(await _Recovery.conversationAsset.findUniqueOrThrow({ where: { id: capture.operation.assetId } })).toMatchObject({ state: ConversationAssetState.Failed, failureCode: "scan_failed" });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: capture.operation.artifactId } })).toMatchObject({ currentRevisionId: null });
		await _ExpectTerminalEvents(capture, "failed");
	});

	it("rolls a scanner verdict back when the parent task wake cannot commit", async function _LostTerminalWake()
	{
		const capture = await _CaptureActualGeneratedFileSqlFixture(_First, _Workflows, _Cipher);
		await _QuarantineActualGeneratedFile(_First, capture);
		const job = await _ClaimActualGeneratedFile(_First, capture.operation);
		let events = 0;
		const interruptedEvents = { emitEventInTransaction: async function _Emit(transaction: Parameters<typeof _Workflows.emitEventInTransaction>[0], task: Parameters<typeof _Workflows.emitEventInTransaction>[1], event: Parameters<typeof _Workflows.emitEventInTransaction>[2])
		{
			events += 1;
			if (events === 2)
				throw new Error("injected parent wake failure");
			return _Workflows.emitEventInTransaction(transaction, task, event);
		} };
		const scanner = _ActualGeneratedFileScanner(_First, capture, interruptedEvents);
		await expect(scanner.complete({ jobId: job.id, attempt: job.attempt, claimFence: job.claimFence!, verdict: ArtifactScannerVerdict.Clean, scannerVersion: "synthetic-sql-verdict" })).rejects.toThrow("injected parent wake failure");
		expect(events).toBe(2);
		expect(await _Recovery.artifactScanJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ state: ArtifactScanJobState.Claimed, claimFence: job.claimFence });
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: capture.operation.revisionId } })).toMatchObject({ state: ArtifactRevisionState.Quarantined });
		expect(await _Recovery.conversationAsset.findUniqueOrThrow({ where: { id: capture.operation.assetId } })).toMatchObject({ state: ConversationAssetState.Processing });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: capture.operation.artifactId } })).toMatchObject({ currentRevisionId: null });
		expect(await _TerminalEvents(capture)).toEqual(new Map());
	});

	it.each(["revoked", "expired"] as const)("denies clean publication after %s authority and preserves the first failure", async function _AuthorityEnded(reason)
	{
		const capture = await _CaptureActualGeneratedFileSqlFixture(_First, _Workflows, _Cipher, reason === "expired" ? { runLifetimeMs: 4_000 } : {});
		await _QuarantineActualGeneratedFile(_First, capture);
		const job = await _ClaimActualGeneratedFile(_First, capture.operation);
		if (reason === "revoked")
			await _First.authorizationGrant.update({ where: { id: capture.fixture.toolGrantId }, data: { revokedAt: new Date() } });
		else
			await _WaitPastSqlDeadline(_Recovery, capture.fixture.candidate.compiledInput.budget.wallClockDeadlineEpochMs!);
		const command = { jobId: job.id, attempt: job.attempt, claimFence: job.claimFence!, verdict: ArtifactScannerVerdict.Clean, scannerVersion: "synthetic-sql-verdict" };
		const scanner = _ActualGeneratedFileScanner(_First, capture);
		await expect(scanner.complete(command)).resolves.toBe("completed");
		await expect(_ActualGeneratedFileScanner(_Recovery, capture).complete(command)).resolves.toBe("idempotent");
		expect(await _Recovery.artifactScanJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ state: ArtifactScanJobState.Clean });
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: capture.operation.revisionId } })).toMatchObject({ state: ArtifactRevisionState.Quarantined });
		expect(await _Recovery.conversationAsset.findUniqueOrThrow({ where: { id: capture.operation.assetId } })).toMatchObject({ state: ConversationAssetState.Failed, failureCode: "generated_file_authority_ended" });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: capture.operation.artifactId } })).toMatchObject({ currentRevisionId: null });
		await _ExpectTerminalEvents(capture, "failed");
	}, 15_000);

	it.each(["fence", "expiry"] as const)("rejects stale scanner %s without changing an actually captured file", async function _RejectsStaleScanner(staleCoordinate)
	{
		const capture = await _CaptureActualGeneratedFileSqlFixture(_First, _Workflows, _Cipher);
		await _QuarantineActualGeneratedFile(_First, capture);
		const job = await _ClaimActualGeneratedFile(_First, capture.operation);
		const scanner = _ActualGeneratedFileScanner(_First, capture);
		if (staleCoordinate === "expiry")
			await _First.artifactScanJob.update({ where: { id: job.id }, data: { claimExpiresAt: new Date(Date.now() - 1_000) } });
		const claimFence = staleCoordinate === "fence" ? randomUUID() : job.claimFence!;
		await expect(scanner.complete({ jobId: job.id, attempt: job.attempt, claimFence, verdict: ArtifactScannerVerdict.Clean, scannerVersion: "synthetic-sql-verdict" })).resolves.toBe("stale");
		expect(await _Recovery.artifactRevision.findUniqueOrThrow({ where: { id: capture.operation.revisionId } })).toMatchObject({ state: ArtifactRevisionState.Quarantined });
		expect(await _Recovery.conversationAsset.findUniqueOrThrow({ where: { id: capture.operation.assetId } })).toMatchObject({ state: ConversationAssetState.Processing });
		expect(await _Recovery.artifact.findUniqueOrThrow({ where: { id: capture.operation.artifactId } })).toMatchObject({ currentRevisionId: null });
		expect(await _TerminalEvents(capture)).toEqual(new Map());
	});

});
