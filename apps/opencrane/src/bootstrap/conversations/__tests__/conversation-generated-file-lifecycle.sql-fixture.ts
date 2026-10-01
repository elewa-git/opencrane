import { randomUUID } from "node:crypto";

import { ArtifactScanJobState, type ConversationGeneratedFile, type Prisma, type PrismaClient } from "@prisma/client";

import { PrismaArtifactQuarantineRepository, PrismaArtifactScanUnitOfWork } from "@opencrane/backend/server/agents/artifacts";
import { McpCompanionCommandKinds } from "@opencrane/backend/server/gateways/mcp";
import { PrismaConversationAssetScanRepository, PrismaConversationGeneratedFileWorkflowRepository, type GeneratedFileWorkflowPersistenceDependencies } from "@opencrane/backend/server/conversation-assets";
import { PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationToolDispatchAuthority } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CaptureConversationGeneratedFileSqlFixture, _PrepareConversationGeneratedFileCaptureSqlFixture } from "./conversation-generated-file-capture.sql-fixture";
import { _GeneratedFileSqlDigest } from "./conversation-generated-file.sql-fixture";

/** Completed real capture returned by the shared MCP SQL fixture. */
export type _ActualGeneratedFileCapture = Awaited<ReturnType<typeof _CaptureConversationGeneratedFileSqlFixture>>;

/** Optional authority lifetime used by a completed capture. */
interface _ActualCaptureOptions
{
	/** Frozen completion-token budget used by continuation recovery proofs. */
	readonly maximumCompletionTokens?: number;
	/** Immutable run lifetime used to prove authority expiry before publication. */
	readonly runLifetimeMs?: number;
}

/** Complete the real MCP result path while retaining a caller-selected short authority lifetime. */
export async function _CaptureActualGeneratedFileSqlFixture(client: PrismaClient, workflows: IWorkflowEngine, cipher: ConversationPrivatePayloadCipher, options: _ActualCaptureOptions = {}): Promise<_ActualGeneratedFileCapture>
{
	if (options.runLifetimeMs === undefined && options.maximumCompletionTokens === undefined)
		return _CaptureConversationGeneratedFileSqlFixture(client, workflows, cipher);
	const prepared = await _PrepareConversationGeneratedFileCaptureSqlFixture(client, workflows, cipher, { maximumCompletionTokens: options.maximumCompletionTokens, runLifetimeMs: options.runLifetimeMs });
	const outcome = await prepared.runtime.authority.completeCompanion(prepared.registered.identity, {
		executionReference: prepared.registered.executionReference,
		podUid: prepared.registered.identity.podUid,
		executionId: prepared.command.executionId,
		claimFence: prepared.command.claimFence,
		completion: { kind: McpCompanionCommandKinds.Invocation, result: prepared.rawResult },
	});
	if (outcome !== "completed")
		throw new Error("Generated-file lifecycle fixture did not complete capture");
	const operation = await client.conversationGeneratedFile.findFirstOrThrow({ where: { runId: prepared.fixture.runId } });
	return { ...prepared, operationId: operation.id, assetId: operation.assetId, operation };
}

/** Compose the exact production owners against one captured run and caller-selected event transport. */
export function _GeneratedFileWorkflowDependencies(capture: _ActualGeneratedFileCapture, eventWorkflows: Pick<IWorkflowEngine, "emitEventInTransaction"> = capture.workflows): GeneratedFileWorkflowPersistenceDependencies
{
	return {
		custodyCipher: capture.cipher,
		toolInvocations: capture.participants,
		workflows: eventWorkflows,
		artifactQuarantine: function _ArtifactQuarantine(transaction)
		{
			return new PrismaArtifactQuarantineRepository(transaction as Prisma.TransactionClient);
		},
		conversationAdmission: function _ConversationAdmission(transaction)
		{
			return new PrismaConversationToolDispatchAuthority(transaction as Prisma.TransactionClient, capture.fixture.dependencies);
		},
		turnEvents: function _TurnEvents(transaction)
		{
			const events = new PrismaConversationComputerTurnWorkflowEventRepository(transaction as Prisma.TransactionClient, eventWorkflows);
			return { emit: events.emitGeneratedFile.bind(events) };
		},
	};
}

/** Bind a synthetic verified promotion receipt to the capture's original fixed upload lease. */
export function _GeneratedFilePromotionReceipt(operation: ConversationGeneratedFile)
{
	return { leaseId: operation.uploadLeaseId, contentAddress: operation.contentAddress, byteLength: Number(operation.byteLength), mediaType: operation.mediaType, receiptDigest: _GeneratedFileSqlDigest(`receipt:${operation.id}`) };
}

/** Admit the exact promoted receipt through the real generated workflow repository. */
export async function _QuarantineActualGeneratedFile(client: PrismaClient, capture: _ActualGeneratedFileCapture): Promise<void>
{
	const operation = capture.operation;
	const receipt = _GeneratedFilePromotionReceipt(operation);
	const task = { taskId: operation.workflowTaskId, taskName: operation.workflowTaskName, idempotencyKey: operation.workflowTaskKey };
	const dependencies = _GeneratedFileWorkflowDependencies(capture);
	await client.$transaction(async function _Quarantine(transaction)
	{
		const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
		const snapshot = await repository.loadCurrent({ operationId: operation.id, siloId: operation.siloId }, task, new Date());
		if (snapshot === null)
			throw new Error("Generated-file lifecycle fixture lost current authority before quarantine");
		const outcome = await repository.finalizeQuarantine(snapshot, task, receipt, new Date());
		if (outcome !== "advanced" && outcome !== "idempotent")
			throw new Error("Generated-file lifecycle fixture could not admit quarantine");
	});
}

/** Compose scanner persistence with the actual generated authority and terminal event owners. */
export function _ActualGeneratedFileScanner(client: PrismaClient, capture: _ActualGeneratedFileCapture, eventWorkflows: Pick<IWorkflowEngine, "emitEventInTransaction"> = capture.workflows): PrismaArtifactScanUnitOfWork
{
	const dependencies = _GeneratedFileWorkflowDependencies(capture, eventWorkflows);
	return new PrismaArtifactScanUnitOfWork(client, 60_000, function _Assets(transaction)
	{
		const generatedFiles = new PrismaConversationGeneratedFileWorkflowRepository(transaction, dependencies);
		return new PrismaConversationAssetScanRepository(transaction, generatedFiles);
	}, capture.workflows);
}

/** Put the capture's pending scan under one exact synthetic scanner fence. */
export function _ClaimActualGeneratedFile(client: PrismaClient, operation: ConversationGeneratedFile, attempt = 1)
{
	return client.artifactScanJob.update({ where: { artifactRevisionId: operation.revisionId }, data: { state: ArtifactScanJobState.Claimed, attempt, claimFence: randomUUID(), claimExpiresAt: new Date(Date.now() + 60_000) } });
}
