import { AgentIdentityKinds, ConversationMessageContentBlockKinds, GeneratedFileResultKinds, type GeneratedFileResultMetadata } from "@opencrane/contracts";
import type { Prisma } from "@prisma/client";

import type { ConversationGeneratedFileResult, ConversationGeneratedFileResultCommand, ConversationGeneratedFileResultRepository } from "@opencrane/backend/server/conversations";
import { ConversationGeneratedFileResultStates } from "@opencrane/backend/server/conversations";
import { ToolInvocationStates, ToolResultDeliveryOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaConversationAssetProductAuthorizationRepository } from "../../conversation-asset-product-authorization";
import { _GeneratedFileCapturedMetadataResult } from "../persistence/generated-file-capture-result";
import { PrismaConversationGeneratedFileRecordRepository } from "../persistence/workflow/prisma-conversation-generated-file-record-repository";
import type { GeneratedFileWorkflowRepository } from "../persistence/workflow/generated-file-workflow-persistence.types";
import { GeneratedFileWorkflowStates } from "../workflow/generated-file-workflow.types";

const _OPERATION_SELECT = {
	id: true, siloId: true, conversationId: true, runId: true, attempt: true, bootstrapId: true,
	computerId: true, leaseId: true, leaseGeneration: true, agentIdentityId: true,
	requesterPrincipalId: true, requesterSubject: true, toolInvocationRowId: true,
	toolInvocationId: true, toolRevisionId: true, serverRevisionId: true, rawResultDigest: true,
	assetId: true, artifactId: true, revisionId: true, uploadLeaseId: true, displayName: true,
	mediaType: true, byteLength: true, workflowTaskId: true, workflowTaskName: true, workflowTaskKey: true,
} satisfies Prisma.ConversationGeneratedFileSelect;

type _Operation = Prisma.ConversationGeneratedFileGetPayload<{ select: typeof _OPERATION_SELECT }>;

/** Projects one captured result only after current conversation, workflow and Artifact authority agree. */
export class PrismaConversationGeneratedFileResultRepository implements ConversationGeneratedFileResultRepository
{
	/** Reads complete relational lifecycle evidence without copying its validation rules. */
	private readonly records: PrismaConversationGeneratedFileRecordRepository;
	/** Rechecks the original requester's current Artifact read permission. */
	private readonly authorization: PrismaConversationAssetProductAuthorizationRepository;

	/** Bind every generated-result read to the tool result's transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly generatedWorkflow: Pick<GeneratedFileWorkflowRepository, "loadCurrent">)
	{
		this.records = new PrismaConversationGeneratedFileRecordRepository(this.transaction);
		this.authorization = new PrismaConversationAssetProductAuthorizationRepository(this.transaction);
	}

	/** Return only server-built file metadata, lifecycle state and authorized Artifact coordinates. */
	async read(command: ConversationGeneratedFileResultCommand): Promise<ConversationGeneratedFileResult>
	{
		const operation = await this.transaction.conversationGeneratedFile.findUnique({ where: { toolInvocationRowId: command.invocation.id }, select: _OPERATION_SELECT });
		if (operation === null)
			return { state: _HasGeneratedMetadata(command.payload) ? ConversationGeneratedFileResultStates.Unavailable : ConversationGeneratedFileResultStates.NotGenerated };

		const now = new Date();
		const record = await this.records.load(operation.id, operation.siloId);
		if (!_CommandMatches(command, operation, now.getTime()) || !_SavedResultMatches(command, operation))
			return { state: ConversationGeneratedFileResultStates.Unavailable };

		const task = { taskId: operation.workflowTaskId, taskName: operation.workflowTaskName, idempotencyKey: operation.workflowTaskKey };
		const current = await this.generatedWorkflow.loadCurrent({ siloId: operation.siloId, operationId: operation.id }, task, now);
		if (current === null)
		{
			const settled = await this.records.load(operation.id, operation.siloId);
			return settled.snapshot.state === GeneratedFileWorkflowStates.Failed
				? _Failed(operation.id, settled.failureCode)
				: { state: ConversationGeneratedFileResultStates.Unavailable };
		}
		if (current.state === GeneratedFileWorkflowStates.PromotionRequired || current.state === GeneratedFileWorkflowStates.ScanPending)
		{
			if (!Number.isSafeInteger(current.notAfterEpochMs) || current.notAfterEpochMs <= now.getTime())
				return { state: ConversationGeneratedFileResultStates.Unavailable };
			return { state: ConversationGeneratedFileResultStates.Pending, operationId: operation.id, notAfterEpochMs: current.notAfterEpochMs };
		}
		if (current.state === GeneratedFileWorkflowStates.Failed)
			return _Failed(operation.id, record.failureCode);
		if (current.state !== GeneratedFileWorkflowStates.Ready || record.snapshot.state !== GeneratedFileWorkflowStates.Ready)
			return { state: ConversationGeneratedFileResultStates.Unavailable };

		const canRead = await this.authorization.canAccess(
			{ siloId: operation.siloId, principalId: operation.requesterPrincipalId },
			{ kind: ProductAuthorizationResourceKinds.Artifact, id: operation.artifactId },
			ProductAuthorizationActions.Read,
		);
		if (!canRead)
			return { state: ConversationGeneratedFileResultStates.Unavailable };
		return {
			state: ConversationGeneratedFileResultStates.Ready,
			operationId: operation.id,
			artifact: { id: operation.assetId, kind: ConversationMessageContentBlockKinds.Artifact, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId, name: operation.displayName, mediaType: operation.mediaType },
		};
	}
}

/** Preserve the saved terminal failure without exposing Artifact coordinates. */
function _Failed(operationId: string, failureCode: string | null): ConversationGeneratedFileResult
{
	if (typeof failureCode !== "string" || failureCode.length === 0)
		return { state: ConversationGeneratedFileResultStates.Unavailable };
	return { state: ConversationGeneratedFileResultStates.Failed, operationId, failureCode };
}

/** Require the turn, current admission, invocation and operation to describe one personal execution. */
function _CommandMatches(command: ConversationGeneratedFileResultCommand, operation: _Operation, nowEpochMs: number): boolean
{
	const { admission, invocation, turn } = command;
	const subject = admission.subject;
	const selection = turn.toolSelection;
	return admission.identity.kind === AgentIdentityKinds.Proxied && admission.notAfterEpochMs > nowEpochMs
		&& operation.siloId === turn.siloId && operation.siloId === turn.binding.siloId && operation.siloId === subject.siloId
		&& operation.conversationId === turn.binding.conversationId && operation.conversationId === admission.conversationId
		&& operation.runId === turn.binding.runId && operation.runId === turn.compile.runId && operation.runId === subject.runScope.runId
		&& operation.attempt === turn.compile.attempt && operation.attempt === subject.runScope.attempt
		&& operation.bootstrapId === turn.bootstrapId && operation.computerId === turn.computerId && operation.computerId === turn.binding.computerId
		&& operation.computerId === subject.computerScope.computerId && operation.leaseId === turn.lease.leaseId
		&& operation.leaseId === subject.computerScope.leaseId && operation.leaseGeneration === turn.lease.leaseGeneration
		&& operation.leaseGeneration === turn.binding.leaseGeneration && operation.leaseGeneration === subject.computerScope.leaseGeneration
		&& operation.agentIdentityId === turn.binding.agentIdentityId && operation.agentIdentityId === admission.identity.id
		&& operation.agentIdentityId === subject.agentIdentityId && turn.binding.agentServiceId === subject.runScope.agentServiceId
		&& operation.requesterPrincipalId === admission.identity.proxiedPrincipalId && operation.requesterPrincipalId === subject.principalId
		&& operation.requesterPrincipalId === subject.requester.requesterPrincipalId && operation.requesterSubject === admission.requesterSubjectId
		&& operation.toolInvocationRowId === invocation.id && operation.toolInvocationId === invocation.toolInvocationId
		&& operation.toolRevisionId === invocation.toolRevisionId && invocation.state === ToolInvocationStates.Succeeded
		&& invocation.siloId === operation.siloId && invocation.runId === operation.runId && invocation.attempt === operation.attempt
		&& invocation.agentRevisionId === subject.runScope.agentRevisionId && invocation.requestIdentity.runtimeInstanceId === operation.computerId
		&& invocation.requestIdentity.commandId === operation.bootstrapId && invocation.mcpTaskId === null
		&& selection !== null && selection.proposalId === invocation.toolInvocationId && selection.requestFingerprint === invocation.requestFingerprint;
}

/** Compare the IAM payload with the one canonical metadata result rebuilt from persisted facts. */
function _SavedResultMatches(command: ConversationGeneratedFileResultCommand, operation: _Operation): boolean
{
	if (command.payload.outcome !== ToolResultDeliveryOutcomes.Succeeded || command.payload.toolInvocationId !== operation.toolInvocationId || command.invocation.result === null)
		return false;
	const metadata: GeneratedFileResultMetadata = {
		kind: GeneratedFileResultKinds.Captured, operationId: operation.id, assetId: operation.assetId,
		artifactId: operation.artifactId, artifactRevisionId: operation.revisionId,
		rawResultDigest: operation.rawResultDigest, displayName: operation.displayName,
		mediaType: operation.mediaType, byteLength: Number(operation.byteLength),
	};
	const expected = _GeneratedFileCapturedMetadataResult(metadata) as unknown as JsonValue;
	return Number.isSafeInteger(metadata.byteLength) && metadata.byteLength > 0
		&& ___DigestCanonicalJson(command.payload.result) === ___DigestCanonicalJson(expected)
		&& ___DigestCanonicalJson(command.invocation.result) === ___DigestCanonicalJson(expected);
}

/** Detect a server-metadata claim when no operation exists for the actual invocation row. */
function _HasGeneratedMetadata(payload: ConversationGeneratedFileResultCommand["payload"]): boolean
{
	if (payload.outcome !== ToolResultDeliveryOutcomes.Succeeded || typeof payload.result !== "object" || payload.result === null || Array.isArray(payload.result))
		return false;
	const structured = "structuredContent" in payload.result ? payload.result.structuredContent : null;
	return typeof structured === "object" && structured !== null && !Array.isArray(structured)
		&& "kind" in structured && structured.kind === GeneratedFileResultKinds.Captured;
}
