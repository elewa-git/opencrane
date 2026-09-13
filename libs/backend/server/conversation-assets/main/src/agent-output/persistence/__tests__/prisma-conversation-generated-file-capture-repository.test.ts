import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, GeneratedFileResultKinds, type McpToolCallResult } from "@opencrane/contracts";
import type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadCoordinates, EncryptedConversationPrivatePayload } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { ___CreateCsvFile, GENERATED_CSV_MEDIA_TYPE } from "@opencrane/models/conversation-assets";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratedFileCaptureError } from "../generated-file-capture-error";
import { GeneratedFileCaptureOutcomes, type CaptureGeneratedFileCommand, type GeneratedFileCurrentExecutionAuthority, type GeneratedFileCurrentExecutionEvidence, type PersistedGeneratedFileReplay } from "../generated-file-capture.types";
import { PrismaConversationGeneratedFileCaptureRepository } from "../prisma-conversation-generated-file-capture-repository";

const _authorization = vi.hoisted(function _AuthorizationMocks()
{
	return { admitWorkload: vi.fn(), reconcileArtifactOwner: vi.fn() };
});

vi.mock("../../../conversation-asset-product-authorization", function _AuthorizationModule()
{
	return { PrismaConversationAssetProductAuthorizationRepository: class { admitWorkload = _authorization.admitWorkload; reconcileArtifactOwner = _authorization.reconcileArtifactOwner; } };
});

const _NOW = new Date("2026-09-13T12:00:00.000Z");
const _ARGUMENTS = { displayName: "county-totals.csv", headers: ["County", "Total"], rows: [["Nairobi", 42]] } as const;

/** Exact personal execution evidence returned only after the external authority adapter checks it. */
function _Evidence(overrides: Partial<GeneratedFileCurrentExecutionEvidence> = {}): GeneratedFileCurrentExecutionEvidence
{
	return {
		siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2,
		bootstrapId: "bootstrap-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 3,
		agentIdentityId: "agent-identity-1", requesterPrincipalId: "principal-1", requesterSubjectId: "subject-1",
		toolInvocationRowId: "invocation-row-1", toolInvocationId: "tool-call-1", toolRevisionId: "tool-revision-1",
		serverRevisionId: "server-revision-1", toolName: "opencrane.files.create_csv", effectiveArguments: _ARGUMENTS as unknown as JsonValue,
		execution: { executionId: "execution-1", executionReference: "reference-1", claimFence: "fence-1" },
		authorizationWorkload: { audience: MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, namespace: "mcp-executors", serviceAccountName: "mcp-executor", workloadKind: "job", workloadUid: "job-1", podUid: "pod-1" },
		authorizationRun: { runId: "run-1", attempt: 2, agentServiceId: "agent-service-1", agentRevisionId: "agent-revision-1" },
		notAfterEpochMs: _NOW.getTime() + 60_000,
		...overrides,
	};
}

/** Terminal request whose resource bytes exactly match the admitted arguments. */
function _Command(result = _ResourceResult()): CaptureGeneratedFileCommand
{
	return { executionId: "execution-1", executionReference: "reference-1", claimFence: "fence-1", podUid: "pod-1", workload: { subject: "system:serviceaccount:mcp-executors:mcp-executor", namespace: "mcp-executors", serviceAccountName: "mcp-executor", podUid: "pod-1" }, result };
}

/** Reuse the shared renderer so capture tests exercise exact byte comparison. */
function _ResourceResult(): McpToolCallResult
{
	const rendered = ___CreateCsvFile(_ARGUMENTS as unknown as JsonValue);
	if (!rendered.accepted)
		throw new Error("test CSV arguments were rejected");
	return { isError: false, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: GENERATED_CSV_MEDIA_TYPE, text: rendered.file.text } }] };
}

/** Reversible test cipher that still verifies the codec's bound coordinates and ciphertext digest. */
function _Cipher()
{
	const encrypt = vi.fn(function _Encrypt(plaintext: string, _coordinates: ConversationPrivatePayloadCoordinates): EncryptedConversationPrivatePayload
	{
		const ciphertext = Buffer.from(plaintext, "utf8");
		return { keyId: "key-1", nonce: Buffer.alloc(12, 1), authTag: Buffer.alloc(16, 2), ciphertext, ciphertextDigest: _Digest(ciphertext) };
	});
	const decrypt = vi.fn(function _Decrypt(payload: EncryptedConversationPrivatePayload, _coordinates: ConversationPrivatePayloadCoordinates): string
	{
		if (_Digest(payload.ciphertext) !== payload.ciphertextDigest)
			throw new Error("ciphertext digest mismatch");
		return Buffer.from(payload.ciphertext).toString("utf8");
	});
	return { cipher: { encrypt, decrypt } satisfies ConversationPrivatePayloadCipher, decrypt, encrypt };
}

/** In-memory Prisma-shaped transaction that makes committed replay observable without a database. */
function _Transaction()
{
	let operation: PersistedGeneratedFileReplay | null = null;
	const payloads = new Map<string, Record<string, unknown>>();
	const events: string[] = [];
	const writes = { artifact: 0, uploadLease: 0, asset: 0, operation: 0, payload: 0, chunk: 0 };
	const transaction = {
		artifact: { create: vi.fn(async function _Create() { events.push("artifact"); writes.artifact += 1; }) },
		artifactUploadLease: { create: vi.fn(async function _Create() { events.push("upload-lease"); writes.uploadLease += 1; }) },
		conversationAsset: { create: vi.fn(async function _Create() { events.push("asset"); writes.asset += 1; }) },
		conversationGeneratedFile: {
			findUnique: vi.fn(async function _Find() { return operation; }),
			create: vi.fn(async function _Create(input: { readonly data: Omit<PersistedGeneratedFileReplay, "chunks"> })
			{
				events.push("operation"); writes.operation += 1;
				operation = { ...input.data, chunks: [] };
				return operation;
			}),
		},
		conversationPrivatePayload: {
			create: vi.fn(async function _Create(input: { readonly data: Record<string, unknown> }) { events.push("payload"); writes.payload += 1; payloads.set(input.data["id"] as string, input.data); }),
			findMany: vi.fn(async function _FindMany(input: { readonly where: { readonly id: { readonly in: readonly string[] } } }) { return input.where.id.in.flatMap(id => payloads.has(id) ? [payloads.get(id)!] : []); }),
		},
		conversationGeneratedFileChunk: { create: vi.fn(async function _Create(input: { readonly data: { readonly operationId: string; readonly index: number; readonly payloadRef: string; readonly decodedByteLength: number; readonly ciphertextDigest: string } })
		{
			events.push("chunk"); writes.chunk += 1;
			if (operation === null)
				throw new Error("operation missing");
			operation = { ...operation, chunks: [...operation.chunks, { index: input.data.index, payloadRef: input.data.payloadRef, decodedByteLength: input.data.decodedByteLength, ciphertextDigest: input.data.ciphertextDigest }] };
		}) },
	};
	return { transaction: transaction as unknown as Prisma.TransactionClient, events, writes };
}

/** Current-execution port that exposes call counts and mutable evidence for boundary cases. */
function _Authority(evidence: GeneratedFileCurrentExecutionEvidence | null = _Evidence())
{
	const admitCurrent = vi.fn(async function _Admit() { return evidence; });
	return { authority: { admitCurrent } satisfies GeneratedFileCurrentExecutionAuthority, admitCurrent };
}

/** Workflow double returns the exact engine-owned task identity unless a test overrides it. */
function _Workflow(onSpawn?: (task: { readonly taskName: string; readonly idempotencyKey: string }) => void)
{
	const spawn = vi.fn(async function _Spawn(transaction: { readonly client: unknown }, task: { readonly taskName: string; readonly idempotencyKey: string })
	{
		onSpawn?.(task);
		return { taskId: "task-1", taskName: task.taskName, idempotencyKey: task.idempotencyKey };
	});
	return { workflow: { spawn } as unknown as Pick<IWorkflowEngine, "spawn">, spawn };
}

describe("PrismaConversationGeneratedFileCaptureRepository", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
		vi.clearAllMocks();
		_authorization.admitWorkload.mockResolvedValue(true);
		_authorization.reconcileArtifactOwner.mockResolvedValue(undefined);
	});

	it("captures one encrypted file, one human-owned artifact and one same-transaction task", async function _CapturesFresh()
	{
		const storage = _Transaction();
		const encryption = _Cipher();
		const execution = _Authority();
		const workflow = _Workflow(function _Spawn() { storage.events.push("spawn"); });
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, encryption.cipher, workflow.workflow, execution.authority);

		const captured = await repository.capture(_Command());

		expect(captured.outcome).toBe(GeneratedFileCaptureOutcomes.Captured);
		if (captured.outcome !== GeneratedFileCaptureOutcomes.Captured)
			throw new Error("capture was not accepted");
		expect(captured.result).toEqual({ isError: false, content: [{ type: "text", text: "Generated file captured and queued for safety scanning." }], structuredContent: expect.objectContaining({ kind: GeneratedFileResultKinds.Captured, rawResultDigest: expect.stringMatching(/^sha256:/u), displayName: "county-totals.csv", mediaType: GENERATED_CSV_MEDIA_TYPE }) });
		expect(JSON.stringify(captured.result)).not.toContain("Nairobi");
		expect(storage.writes).toEqual({ artifact: 1, uploadLease: 1, asset: 1, operation: 1, payload: 1, chunk: 1 });
		expect(storage.transaction.conversationAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ provenance: "AgentOutput", createdByUserId: "subject-1" }) });
		expect(storage.transaction.artifactUploadLease.create).toHaveBeenCalledWith({ data: expect.objectContaining({ expiresAt: new Date(_NOW.getTime() + 60_000), expectedContentAddress: expect.stringMatching(/^sha256:/u) }) });
		expect(_authorization.admitWorkload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ principalId: "principal-1" }), expect.objectContaining({ workload: expect.objectContaining({ podUid: "pod-1", workloadUid: "job-1" }), run: expect.objectContaining({ runId: "run-1", attempt: 2 }) }), { kind: ProductAuthorizationResourceKinds.ArtifactCollection, id: "silo-1" }, ProductAuthorizationActions.Create, expect.objectContaining({ contentAddress: expect.stringMatching(/^sha256:/u), byteLength: expect.any(Number) }));
		expect(_authorization.reconcileArtifactOwner).toHaveBeenCalledExactlyOnceWith("silo-1", expect.any(String), "principal-1", _NOW);
		expect(workflow.spawn).toHaveBeenCalledWith({ client: storage.transaction }, expect.objectContaining({ taskName: "conversation-generated-file", input: expect.objectContaining({ siloId: "silo-1" }) }));
		expect(storage.events).toEqual(["artifact", "upload-lease", "asset", "spawn", "operation", "payload", "chunk"]);
	});

	it("decrypts exact committed custody on replay without new authorization, encryption, writes or task", async function _Replays()
	{
		const storage = _Transaction();
		const encryption = _Cipher();
		const execution = _Authority();
		const workflow = _Workflow();
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, encryption.cipher, workflow.workflow, execution.authority);
		const first = await repository.capture(_Command());

		const replay = await repository.capture(_Command());

		expect(replay).toEqual(first);
		expect(execution.admitCurrent).toHaveBeenCalledTimes(2);
		expect(encryption.encrypt).toHaveBeenCalledOnce();
		expect(encryption.decrypt).toHaveBeenCalledOnce();
		expect(workflow.spawn).toHaveBeenCalledOnce();
		expect(_authorization.admitWorkload).toHaveBeenCalledOnce();
		expect(_authorization.reconcileArtifactOwner).toHaveBeenCalledOnce();
		expect(storage.writes).toEqual({ artifact: 1, uploadLease: 1, asset: 1, operation: 1, payload: 1, chunk: 1 });
	});

	it("refuses changed resource bytes and foreign replay coordinates before any new effect", async function _ReplayConflicts()
	{
		const storage = _Transaction();
		const encryption = _Cipher();
		const workflow = _Workflow();
		const first = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, encryption.cipher, workflow.workflow, _Authority().authority);
		await first.capture(_Command());

		const changedResult = structuredClone(_ResourceResult());
		(changedResult.content[0] as { resource: { text: string } }).resource.text = "changed";
		await expect(first.capture(_Command(changedResult))).rejects.toBeInstanceOf(GeneratedFileCaptureError);
		const foreign = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, encryption.cipher, workflow.workflow, _Authority(_Evidence({ runId: "run-2", authorizationRun: { runId: "run-2", attempt: 2, agentServiceId: "agent-service-1", agentRevisionId: "agent-revision-1" } })).authority);
		await expect(foreign.capture(_Command())).rejects.toThrow("replay conflicted");
		expect(workflow.spawn).toHaveBeenCalledOnce();
		expect(_authorization.admitWorkload).toHaveBeenCalledOnce();
		expect(storage.writes).toEqual({ artifact: 1, uploadLease: 1, asset: 1, operation: 1, payload: 1, chunk: 1 });
	});

	it("rejects denied creation before artifact custody or workflow admission", async function _Denied()
	{
		_authorization.admitWorkload.mockResolvedValue(false);
		const storage = _Transaction();
		const encryption = _Cipher();
		const workflow = _Workflow();
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, encryption.cipher, workflow.workflow, _Authority().authority);

		await expect(repository.capture(_Command())).rejects.toThrow("creation was denied");
		expect(storage.writes).toEqual({ artifact: 0, uploadLease: 0, asset: 0, operation: 0, payload: 0, chunk: 0 });
		expect(encryption.encrypt).not.toHaveBeenCalled();
		expect(workflow.spawn).not.toHaveBeenCalled();
	});

	it("throws after a mismatched task receipt so the caller rolls back preceding writes", async function _TaskReceiptMismatch()
	{
		const storage = _Transaction();
		const spawn = vi.fn(async function _Spawn() { return { taskId: "task-1", taskName: "foreign-task", idempotencyKey: "foreign-key" }; });
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, _Cipher().cipher, { spawn } as unknown as Pick<IWorkflowEngine, "spawn">, _Authority().authority);

		await expect(repository.capture(_Command())).rejects.toThrow("conflicting task receipt");
		expect(storage.writes.operation).toBe(0);
		expect(storage.writes.payload).toBe(0);
		expect(storage.writes.chunk).toBe(0);
	});

	it("rechecks the deadline after task admission and fails the complete transaction before final writes", async function _DeadlineFence()
	{
		const storage = _Transaction();
		const workflow = _Workflow(function _Expire() { vi.setSystemTime(new Date(_NOW.getTime() + 60_000)); });
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, _Cipher().cipher, workflow.workflow, _Authority().authority);

		await expect(repository.capture(_Command())).rejects.toThrow("authority ended");
		expect(workflow.spawn).toHaveBeenCalledOnce();
		expect(storage.writes.operation).toBe(0);
		expect(storage.writes.payload).toBe(0);
		expect(storage.writes.chunk).toBe(0);
	});

	it("leaves an ordinary scalar tool result to its existing completion owner", async function _NotApplicable()
	{
		const storage = _Transaction();
		const workflow = _Workflow();
		const evidence = _Evidence({ toolName: "records.search", effectiveArguments: {} });
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, _Cipher().cipher, workflow.workflow, _Authority(evidence).authority);

		await expect(repository.capture(_Command({ isError: false, content: [{ type: "text", text: "record found" }] }))).resolves.toEqual({ outcome: GeneratedFileCaptureOutcomes.NotApplicable });
		expect(_authorization.admitWorkload).not.toHaveBeenCalled();
		expect(workflow.spawn).not.toHaveBeenCalled();
		expect(storage.writes).toEqual({ artifact: 0, uploadLease: 0, asset: 0, operation: 0, payload: 0, chunk: 0 });
	});

	it("rejects stale or mismatched companion proof before parsing or persistence", async function _InvalidCurrentProof()
	{
		const storage = _Transaction();
		const workflow = _Workflow();
		const repository = new PrismaConversationGeneratedFileCaptureRepository(storage.transaction, _Cipher().cipher, workflow.workflow, _Authority(_Evidence({ execution: { executionId: "execution-2", executionReference: "reference-1", claimFence: "fence-1" } })).authority);

		await expect(repository.capture(_Command())).rejects.toThrow("authority ended");
		expect(_authorization.admitWorkload).not.toHaveBeenCalled();
		expect(workflow.spawn).not.toHaveBeenCalled();
	});
});

/** Full lowercase content digest used by the reversible test cipher. */
function _Digest(value: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
