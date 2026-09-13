import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { _CreateConversationGeneratedFileResultParticipant } from "@opencrane/backend/server/conversation-assets";
import { CONVERSATION_COMPUTER_TURN_TASK, PrismaConversationToolDispatchAuthority, PrismaConversationToolProposalUnitOfWork } from "@opencrane/backend/server/conversations";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTaskSpawn, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { McpCompanionCommandKinds, type McpInvocationResultParticipantFactory } from "@opencrane/backend/server/gateways/mcp";
import { type McpToolCallResult } from "@opencrane/contracts";
import { GENERATED_CSV_INPUT_SCHEMA, GENERATED_CSV_MEDIA_TYPE, GENERATED_CSV_TOOL_NAME, ___CreateCsvFile } from "@opencrane/models/conversation-assets";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { _ToolHandoffSqlRuntime } from "./conversation-tool-handoff.sql-fixture";
import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Metadata-only resource identifier returned by the credentialless producer. */
export const _GENERATED_FILE_RESOURCE_URI = "urn:opencrane:generated-file:csv";
/** Admitted CSV arguments shared by the actual producer renderer and capture parser. */
export const _GENERATED_FILE_ARGUMENTS = { displayName: "county-totals.csv", headers: ["county", "total"], rows: [["Nairobi", 42], ["Mombasa", 17]] } as const;
/** Workload already proved by the conversation-computer proposal boundary. */
export const _GENERATED_FILE_PROPOSER = { audience: "opencrane-conversation-computer", namespace: "computers", serviceAccountName: "computer", workloadKind: "pod", workloadUid: "generated-file-capture-proof", podUid: "generated-file-capture-proof" } as const;

/** Optional hook that observes durable capture before IAM terminal persistence. */
interface _CaptureOptions
{
	/** Runs after capture and may throw to prove the surrounding completion transaction rolls back. */
	readonly afterCapture?: (result: McpToolCallResult) => Promise<void>;
	/** Companion claim lifetime used by stale-authority cases. */
	readonly companionLeaseMs?: number;
	/** Frozen completion-token budget retained before the generated invocation is admitted. */
	readonly maximumCompletionTokens?: number;
	/** Immutable run lifetime used by stale-authority cases. */
	readonly runLifetimeMs?: number;
}

/** Real MCP completion context returned before the terminal result is submitted. */
export interface _PreparedGeneratedFileCaptureSqlFixture
{
	/** Actual synthetic file result returned by the declared CSV producer. */
	readonly rawResult: McpToolCallResult;
	/** Current invocation command claimed by the registered MCP companion. */
	readonly command: Extract<Awaited<ReturnType<ReturnType<typeof _ToolHandoffSqlRuntime>["authority"]["claimCompanion"]>>, { readonly kind: McpCompanionCommandKinds.Invocation }>;
	/** Shared cipher used for the capture and later replay verification. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Original proposal/run authority fixture. */
	readonly fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>;
	/** Actual task receipts returned by Absurd admission attempts. */
	readonly taskReceipts: readonly IWorkflowTaskReceipt[];
	/** Result factory installed on the MCP completion transaction. */
	readonly invocationResults: McpInvocationResultParticipantFactory;
	/** Real transaction participants used for IAM invocation persistence. */
	readonly participants: ReturnType<typeof _ToolHandoffSqlRuntime>["participants"];
	/** Saved parent conversation task used by terminal generated-output wake proofs. */
	readonly parentTaskReceipt: IWorkflowTaskReceipt;
	/** Registered executor and TokenReview-shaped identity. */
	readonly registered: NonNullable<Awaited<ReturnType<ReturnType<typeof _ToolHandoffSqlRuntime>["register"]>>>;
	/** Actual MCP runtime unit of work with generated-result capture installed. */
	readonly runtime: ReturnType<typeof _ToolHandoffSqlRuntime>;
	/** Actual workflow engine that admitted the generated-file task. */
	readonly workflows: IWorkflowEngine;
}

/** Add the exact human ArtifactCollection/Create grant consumed by generated capture. */
async function _GrantArtifactCreation(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>): Promise<void>
{
	const original = await client.authorizationGrant.findUniqueOrThrow({ where: { id: fixture.toolGrantId } });
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ArtifactCollection, ProductAuthorizationActions.Create);
	if (capability === null)
		throw new Error("Generated-file SQL fixture requires the ArtifactCollection/Create capability");
	await client.authorizationGrant.create({ data: {
		...original,
		id: randomUUID(),
		catalogId: capability.catalog.catalogId,
		catalogRevision: capability.catalog.revision,
		catalogDigest: capability.catalog.digest,
		capabilityId: capability.capabilityId,
		resourceKind: ProductAuthorizationResourceKinds.ArtifactCollection,
		resourceId: fixture.siloId,
	} });
}

/** Build the exact embedded resource produced from the admitted CSV arguments. */
export function _GeneratedFileRawResult(): McpToolCallResult
{
	const generated = ___CreateCsvFile(_GENERATED_FILE_ARGUMENTS);
	if (!generated.accepted)
		throw new Error("Generated-file SQL fixture arguments must remain valid");
	return { isError: false, content: [{ type: "resource", resource: { uri: _GENERATED_FILE_RESOURCE_URI, mimeType: GENERATED_CSV_MEDIA_TYPE, text: generated.file.text } }] };
}

/** Observe real task admission while preserving the engine's transaction-bound spawn behavior. */
function _ObservedWorkflows(workflows: IWorkflowEngine, taskReceipts: IWorkflowTaskReceipt[]): Pick<IWorkflowEngine, "spawn">
{
	return { async spawn<Input>(transaction: IWorkflowTransaction, task: IWorkflowTaskSpawn<Input>): Promise<IWorkflowTaskReceipt>
	{
		const receipt = await workflows.spawn(transaction, task);
		taskReceipts.push(receipt);
		return receipt;
	} };
}

/** Bind the public generated-result participant to every actual MCP completion transaction. */
export function _GeneratedFileInvocationResultsSqlFixture(fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, cipher: ConversationPrivatePayloadCipher, workflows: Pick<IWorkflowEngine, "spawn">, afterCapture?: _CaptureOptions["afterCapture"]): McpInvocationResultParticipantFactory
{
	return { __ForTransaction: function _ForTransaction(transactionValue)
	{
		const transaction = transactionValue as Prisma.TransactionClient;
		const dispatch = new PrismaConversationToolDispatchAuthority(transaction, fixture.dependencies);
		const participant = _CreateConversationGeneratedFileResultParticipant(transaction, cipher, workflows, dispatch, true);
		return { async prepare(command)
		{
			const result = await participant.prepare(command);
			if (afterCapture !== undefined)
				await afterCapture(result);
			return result;
		} };
	} };
}

/**
 * Admit and claim one actual generated CSV invocation without completing it.
 * Callers can submit the returned raw result, alter only its fence, or inject a post-capture failure.
 */
export async function _PrepareConversationGeneratedFileCaptureSqlFixture(client: PrismaClient, workflows: IWorkflowEngine, cipher: ConversationPrivatePayloadCipher, options: _CaptureOptions = {}): Promise<_PreparedGeneratedFileCaptureSqlFixture>
{
	const fixture = await _SeedConversationToolProposalSqlFixture({
		maximumCompletionTokens: options.maximumCompletionTokens,
		runLifetimeMs: options.runLifetimeMs,
		tool: { name: GENERATED_CSV_TOOL_NAME, description: "Create a UTF-8 CSV file from bounded tabular values.", inputSchema: GENERATED_CSV_INPUT_SCHEMA, arguments: _GENERATED_FILE_ARGUMENTS },
	});
	await _GrantArtifactCreation(client, fixture);
	workflows.declare(CONVERSATION_COMPUTER_TURN_TASK);
	const activationEventId = randomUUID();
	const parentTaskReceipt = await client.$transaction(async function _BindParentTask(transaction)
	{
		const input = { siloId: fixture.siloId, computerId: fixture.turn.computerId, leaseId: fixture.turn.lease.leaseId, leaseGeneration: fixture.turn.lease.leaseGeneration, activationEventId, causationId: fixture.turn.latestPendingEntryId, causationPosition: fixture.turn.latestPendingEntryPosition };
		const receipt = await workflows.spawn({ client: transaction }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: activationEventId, input });
		await transaction.agentRun.update({ where: { id: fixture.runId }, data: { workflowTaskId: receipt.taskId, workflowTaskName: receipt.taskName, workflowTaskKey: receipt.idempotencyKey } });
		return receipt;
	});
	const taskReceipts: IWorkflowTaskReceipt[] = [];
	const observedWorkflows = _ObservedWorkflows(workflows, taskReceipts);
	const invocationResults = _GeneratedFileInvocationResultsSqlFixture(fixture, cipher, observedWorkflows, options.afterCapture);
	const runtime = _ToolHandoffSqlRuntime(client, fixture, options.companionLeaseMs ?? 300_000, invocationResults);
	const proposals = new PrismaConversationToolProposalUnitOfWork(client, fixture.dependencies, runtime.admission, async function _ApprovalExpiry() {});
	await proposals.admit(fixture.turn, fixture.candidate, fixture.proposal, _GENERATED_FILE_PROPOSER);
	const registered = await runtime.register();
	if (registered === null)
		throw new Error("Generated-file SQL fixture requires a registered MCP execution");
	const command = await runtime.authority.claimCompanion(registered.identity, registered.executionReference);
	if (command === null || typeof command === "string" || command.kind !== "invocation")
		throw new Error("Generated-file SQL fixture requires a current invocation claim");
	return { rawResult: _GeneratedFileRawResult(), command, cipher, fixture, taskReceipts, invocationResults, parentTaskReceipt, participants: runtime.participants, registered, runtime, workflows };
}

/** Complete the real MCP, capture, IAM and Absurd transaction for scanner/quarantine SQL suites. */
export async function _CaptureConversationGeneratedFileSqlFixture(client: PrismaClient, workflows: IWorkflowEngine, cipher: ConversationPrivatePayloadCipher)
{
	const prepared = await _PrepareConversationGeneratedFileCaptureSqlFixture(client, workflows, cipher);
	const outcome = await prepared.runtime.authority.completeCompanion(prepared.registered.identity, {
		executionReference: prepared.registered.executionReference,
		podUid: prepared.registered.identity.podUid,
		executionId: prepared.command.executionId,
		claimFence: prepared.command.claimFence,
		completion: { kind: McpCompanionCommandKinds.Invocation, result: prepared.rawResult },
	});
	if (outcome !== "completed")
		throw new Error("Generated-file SQL fixture did not complete capture");
	const operation = await client.conversationGeneratedFile.findFirstOrThrow({ where: { runId: prepared.fixture.runId } });
	return { ...prepared, operationId: operation.id, assetId: operation.assetId, operation };
}
