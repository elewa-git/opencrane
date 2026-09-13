import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { _CaptureGeneratedFileSqlFixture, _FinishGeneratedFileSqlRuntimes, _GeneratedFileSqlDigest } from "./conversation-generated-file.sql-fixture";

/** Writer and recovery clients share only the committed PostgreSQL state. */
const _First = new PrismaClient();
/** Independent reader used after committed and rejected writes. */
const _Recovery = new PrismaClient();

describe("generated-file custody authority on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Generated-file SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Recovery.$connect()]);
	});
	afterEach(_FinishGeneratedFileSqlRuntimes);
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Recovery.$disconnect()]); });

	it("commits one operation and one complete relational manifest", async function _CompleteManifest()
	{
		const capture = await _CaptureGeneratedFileSqlFixture(_First);
		await expect(_Recovery.conversationGeneratedFile.findUniqueOrThrow({ where: { id: capture.operationId }, include: { chunks: true } })).resolves.toMatchObject({ id: capture.operationId, chunkCount: 1, chunks: [{ operationId: capture.operationId, index: 0, payloadRef: capture.payloadRef }] });
	});

	it("rejects a missing manifest at transaction commit", async function _MissingManifest()
	{
		await expect(_CaptureGeneratedFileSqlFixture(_First, { includeChunk: false })).rejects.toThrow("contiguous complete chunk manifest");
	});

	it("rejects a spliced payload row and keeps operation evidence immutable", async function _SplicedAndImmutable()
	{
		const capture = await _CaptureGeneratedFileSqlFixture(_First);
		await expect(_Recovery.conversationGeneratedFile.update({ where: { id: capture.operationId }, data: { contentAddress: _GeneratedFileSqlDigest("changed") } })).rejects.toThrow("immutable");
		await expect(_Recovery.conversationGeneratedFileChunk.delete({ where: { operationId_index: { operationId: capture.operationId, index: 0 } } })).rejects.toThrow("immutable");
		await expect(_Recovery.conversationGeneratedFileChunk.create({ data: { operationId: capture.operationId, index: 1, payloadRef: `generated-file-chunk:${randomUUID().replaceAll("-", "").repeat(2)}`, decodedByteLength: 1, ciphertextDigest: _GeneratedFileSqlDigest("foreign") } })).rejects.toThrow("existing operation index");
	});

	it("rejects an unclaimed invocation, stale lease and non-deterministic task key", async function _RejectsUnboundContext()
	{
		await expect(_CaptureGeneratedFileSqlFixture(_First, { claimCompanion: false })).rejects.toThrow();
		await expect(_CaptureGeneratedFileSqlFixture(_First, { uploadLeaseExpiresAt: new Date(Date.now() - 1_000) })).rejects.toThrow();
		await expect(_CaptureGeneratedFileSqlFixture(_First, { operationWorkflowTaskKey: "conversation-generated-file:wrong" })).rejects.toThrow();
	});

	it("rejects a payload idempotency mismatch and an inexact chunk length", async function _RejectsChunkMismatch()
	{
		await expect(_CaptureGeneratedFileSqlFixture(_First, { payloadIdempotencyKey: "foreign-payload" })).rejects.toThrow();
		await expect(_CaptureGeneratedFileSqlFixture(_First, { decodedByteLength: 1 })).rejects.toThrow();
	});

	it("rejects reusing one workflow task receipt", async function _RejectsDuplicateTask()
	{
		const workflowTaskKey = `conversation-generated-file:${randomUUID().replaceAll("-", "").repeat(2)}`;
		await _CaptureGeneratedFileSqlFixture(_First, { operationWorkflowTaskKey: workflowTaskKey });
		await expect(_CaptureGeneratedFileSqlFixture(_First, { operationWorkflowTaskKey: workflowTaskKey })).rejects.toThrow();
	});

});
