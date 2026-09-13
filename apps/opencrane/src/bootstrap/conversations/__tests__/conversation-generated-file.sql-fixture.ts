import { createHash, randomUUID } from "node:crypto";

import { ArtifactKind, ConversationAssetProvenance, ConversationAssetState, type PrismaClient } from "@prisma/client";

import { PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import { ExecutionSubjectMembershipKinds } from "@opencrane/contracts";

import { _ToolHandoffSqlRuntime } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Workload identity already admitted by the conversation tool proposal fixture. */
const _WORKLOAD = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "generated-file-proof-pod", podUid: "generated-file-proof-pod" } as const;
/** Fixture runtimes remain reachable until the case cleanup hook runs. */
const _Runtimes = new Set<ReturnType<typeof _ToolHandoffSqlRuntime>>();

type _CaptureOptions = {
	readonly includeChunk?: boolean;
	readonly claimCompanion?: boolean;
	readonly operationWorkflowTaskId?: string;
	readonly operationWorkflowTaskKey?: string;
	readonly payloadIdempotencyKey?: string;
	readonly decodedByteLength?: number;
	readonly uploadLeaseExpiresAt?: Date;
};

/** Computes the lowercase content address used by the generated-file operation. */
export function _GeneratedFileSqlDigest(value: string): string
{
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Computes the hexadecimal digest used in deterministic structural reference keys. */
function _HexDigest(value: string): string
{
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Creates the claimed MCP context and structural generated-file rows used by each case.
 * This fixture does not claim Absurd task admission; it supplies a synthetic task id.
 */
export async function _CaptureGeneratedFileSqlFixture(client: PrismaClient, options: _CaptureOptions = {})
{
	const fixture = await _SeedConversationToolProposalSqlFixture();
	const membership = fixture.subject.requester.membership;
	if (membership.kind !== ExecutionSubjectMembershipKinds.Standalone)
		throw new Error("Generated-file SQL proof requires a standalone requester");
	const requesterSubject = membership.subjectId;
	const runtime = _ToolHandoffSqlRuntime(client, fixture);
	_Runtimes.add(runtime);
	const owner = new PrismaConversationToolProposalUnitOfWork(client, fixture.dependencies, runtime.admission, async function _ApprovalExpiry() {});
	await owner.admit(fixture.turn, fixture.candidate, fixture.proposal, _WORKLOAD);
	const registered = await runtime.register();
	if (registered === null)
		throw new Error("Generated-file SQL proof requires a registered MCP execution");
	if (options.claimCompanion !== false)
	{
		const companionClaimClaimed = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
		const companionClaim = companionClaimClaimed === null || typeof companionClaimClaimed === "string" ? companionClaimClaimed : companionClaimClaimed.command;
		if (companionClaim === null || typeof companionClaim === "string")
			throw new Error("Generated-file SQL proof requires a claimed MCP execution");
	}
	const invocation = await client.toolInvocation.findFirstOrThrow({ where: { runId: fixture.runId } });
	const runtimeExecution = await client.mcpRuntimeExecution.findUniqueOrThrow({ where: { toolInvocationId: invocation.id } });
	const content = "generated file";
	const contentAddress = _GeneratedFileSqlDigest(content);
	const artifactId = randomUUID();
	const assetId = randomUUID();
	const uploadLeaseId = randomUUID();
	const operationId = randomUUID();
	const revisionId = randomUUID();
	const payloadRef = `generated-file-chunk:${_HexDigest(`${operationId}:0`)}`;
	const workflowTaskKey = `conversation-generated-file:${_HexDigest(operationId)}`;
	const ciphertext = Buffer.from("encrypted-csv");
	const ciphertextDigest = _GeneratedFileSqlDigest(ciphertext.toString("utf8"));
	const now = new Date();
	await client.$transaction(async function _Save(transaction)
	{
		await transaction.artifact.create({ data: { id: artifactId, siloId: fixture.siloId, ownerPrincipalId: fixture.principalId, kind: ArtifactKind.Generated } });
		await transaction.artifactUploadLease.create({ data: { id: uploadLeaseId, artifactId, siloId: fixture.siloId, capabilityJti: randomUUID(), expectedContentAddress: contentAddress, expectedByteLength: BigInt(Buffer.byteLength(content)), mediaType: "text/csv;charset=utf-8", expiresAt: options.uploadLeaseExpiresAt ?? new Date(now.getTime() + 60_000) } });
		await transaction.conversationAsset.create({ data: { id: assetId, siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, artifactId, uploadLeaseId, idempotencyKey: operationId, provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading, displayName: "generated.csv", mediaType: "text/csv;charset=utf-8", byteLength: BigInt(Buffer.byteLength(content)), createdByUserId: requesterSubject } });
		await transaction.conversationGeneratedFile.create({ data: { id: operationId, siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, runId: fixture.runId, attempt: 1, bootstrapId: fixture.turn.bootstrapId, computerId: fixture.turn.computerId, leaseId: fixture.turn.lease.leaseId, leaseGeneration: fixture.turn.lease.leaseGeneration, agentIdentityId: fixture.subject.agentIdentityId, requesterPrincipalId: fixture.principalId, requesterSubject: requesterSubject, toolInvocationRowId: invocation.id, toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, serverRevisionId: runtimeExecution.serverRevisionId, rawResultDigest: _GeneratedFileSqlDigest("raw result"), custodyManifestVersion: "generated-file-custody.v1", ciphertextManifestDigest: _GeneratedFileSqlDigest("manifest"), assetId, artifactId, revisionId, uploadLeaseId, contentAddress, byteLength: BigInt(Buffer.byteLength(content)), chunkCount: 1, displayName: "generated.csv", mediaType: "text/csv;charset=utf-8", workflowTaskId: options.operationWorkflowTaskId ?? randomUUID(), workflowTaskName: "conversation-generated-file", workflowTaskKey: options.operationWorkflowTaskKey ?? workflowTaskKey } });
		await transaction.conversationPrivatePayload.create({ data: { id: payloadRef, siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, authorSubject: fixture.subject.agentIdentityId, idempotencyKey: options.payloadIdempotencyKey ?? payloadRef, keyId: "generated-key", nonce: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext, ciphertextDigest } });
		if (options.includeChunk !== false)
			await transaction.conversationGeneratedFileChunk.create({ data: { operationId, index: 0, payloadRef, decodedByteLength: options.decodedByteLength ?? Buffer.byteLength(content), ciphertextDigest } });
	});
	return { fixture, operationId, assetId, payloadRef, runtime };
}

/** Finish every synthetic MCP runtime created by the current SQL case. */
export async function _FinishGeneratedFileSqlRuntimes(): Promise<void>
{
	for (const runtime of _Runtimes)
		await runtime.register();
	_Runtimes.clear();
}
