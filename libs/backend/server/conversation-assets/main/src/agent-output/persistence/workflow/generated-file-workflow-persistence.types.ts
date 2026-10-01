import type { ArtifactQuarantineRepository } from "@opencrane/backend/server/agents/artifacts";
import type { ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { ConversationToolSystemExecutionAdmissionAuthority } from "@opencrane/backend/server/conversations";
import type { McpToolInvocationTransactionParticipantFactory } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowEngine, IWorkflowTaskEvent, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { GeneratedFileCustodyManifest, SealedGeneratedFileChunk } from "../../custody/file-custody.types";
import type { GeneratedFilePromotionAuthority } from "../../promotion/generated-file-promotion.types";
import type { GeneratedFilePromotionReceipt, GeneratedFileWorkflowPersistence, GeneratedFileWorkflowSnapshot, GeneratedFileWorkflowStates } from "../../workflow/generated-file-workflow.types";

/** Stable generated-file failure codes persisted on the conversation asset. */
export enum GeneratedFileWorkflowFailureCodes
{
	/** Current run, requester, conversation, identity, lease, assignment or permission ended. */
	AuthorityEnded = "generated_file_authority_ended",
}

/** Fixed audit identity for generated-file work resumed by the OpenCrane server. */
export const CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR = "opencrane-server/conversation-generated-file-v1";

/** Terminal metadata emitted to one task; the event grants no Artifact read authority. */
export interface GeneratedFileTerminalEvent
{
	/** Immutable generated-file operation whose state must be reloaded. */
	readonly operationId: string;
	/** Safe terminal state already committed with this event. */
	readonly state: GeneratedFileWorkflowStates.Ready | GeneratedFileWorkflowStates.Failed;
}

/** Conversations-owned event writer that resolves the parent turn receipt inside this transaction. */
export interface GeneratedFileParentTurnEventRepository
{
	/** Emit the operation-scoped wake to the exact saved parent turn or throw when no owner exists. */
	emit(runId: string, attempt: number, event: IWorkflowTaskEvent<GeneratedFileTerminalEvent>): Promise<void>;
}

/** Creates one parent-turn event writer bound to the caller's exact transaction. */
export interface GeneratedFileParentTurnEventRepositoryFactory
{
	/** Bind the existing conversations receipt owner without exposing its Prisma tables here. */
	(transaction: unknown): GeneratedFileParentTurnEventRepository;
}

/** Creates the existing current conversation execution admission owner on one transaction. */
export interface GeneratedFileConversationAdmissionFactory
{
	/** Bind the conversations authority that reuses dispatch, membership and tool assignment checks. */
	(transaction: unknown): ConversationToolSystemExecutionAdmissionAuthority;
}

/** Creates the Artifact-owned quarantine repository on the same transaction as asset progression. */
export interface GeneratedFileArtifactQuarantineFactory
{
	/** Bind the existing receipt, revision and scan admission owner. */
	(transaction: unknown): ArtifactQuarantineRepository;
}

/** Fixed dependencies shared by each fresh generated-file persistence transaction. */
export interface GeneratedFileWorkflowPersistenceDependencies
{
	/** Existing Artifact quarantine owner. */
	readonly artifactQuarantine: GeneratedFileArtifactQuarantineFactory;
	/** Existing conversations current-execution authority. */
	readonly conversationAdmission: GeneratedFileConversationAdmissionFactory;
	/** Existing conversation payload cipher used only after relational custody is complete. */
	readonly custodyCipher: ConversationPrivatePayloadCipher;
	/** Existing authorization-owned invocation reader factory. */
	readonly toolInvocations: McpToolInvocationTransactionParticipantFactory;
	/** Conversations-owned resolver and event writer for the parent turn task. */
	readonly turnEvents: GeneratedFileParentTurnEventRepositoryFactory;
	/** Engine event writer used for the generated-file task receipt saved on the operation. */
	readonly workflows: Pick<IWorkflowEngine, "emitEventInTransaction">;
}

/** Same-transaction terminal notifier composed into the existing Artifact scanner lifecycle. */
export interface GeneratedFileTerminalEventRepository
{
	/** Wake the generated-file task and its parent turn after the scanner commits Ready or Failed. */
	emitTerminal(operationId: string): Promise<void>;
}

/** Transaction repository contract shared by the workflow, promotion adapter and scanner composition. */
export interface GeneratedFileWorkflowRepository extends GeneratedFileWorkflowPersistence, GeneratedFilePromotionAuthority, GeneratedFileTerminalEventRepository {}

/** Root-client contract that opens a fresh transaction for each workflow or promotion advancement. */
export interface GeneratedFileWorkflowUnitOfWork extends GeneratedFileWorkflowPersistence, GeneratedFilePromotionAuthority {}

/** Validated relational evidence needed by current authority and lifecycle composition. */
export interface GeneratedFileWorkflowRecord
{
	/** Immutable personal agent identity that authored the generated bytes. */
	readonly agentIdentityId: string;
	/** Conversation asset whose state is the generated-file lifecycle projection. */
	readonly assetId: string;
	/** Original positive conversation computer lease generation. */
	readonly computerLeaseGeneration: number;
	/** Original conversation computer lease. */
	readonly computerLeaseId: string;
	/** Original conversation computer. */
	readonly computerId: string;
	/** Personal conversation that owns the generated asset. */
	readonly conversationId: string;
	/** Complete validated state and Artifact coordinates. */
	readonly snapshot: GeneratedFileWorkflowSnapshot;
	/** Original execution attempt. */
	readonly attempt: number;
	/** Stable failure code on a terminal asset, or null. */
	readonly failureCode: string | null;
	/** Authorization-owned invocation row captured with the operation. */
	readonly invocationRowId: string;
	/** Runtime-facing invocation id captured with the operation. */
	readonly invocationId: string;
	/** Exact immutable MCP tool revision captured with the operation. */
	readonly toolRevisionId: string;
	/** Human Principal represented by the personal execution. */
	readonly requesterPrincipalId: string;
	/** Human participant subject that owns the conversation asset and revision. */
	readonly requesterSubjectId: string;
	/** Original personal AgentRun. */
	readonly runId: string;
	/** Exact generated task receipt saved by capture. */
	readonly task: IWorkflowTaskReceipt;
	/** Original active fixed lease, retained after promotion only as immutable claims. */
	readonly uploadLease: ArtifactWriteLeaseClaims;
	/** Whether the original lease still admits the one promotion. */
	readonly uploadLeaseActive: boolean;
	/** Exact consumed promotion receipt, or null before quarantine. */
	readonly savedPromotion: GeneratedFilePromotionReceipt | null;
}

/** Complete encrypted custody values loaded only after current authority succeeds. */
export interface GeneratedFileWorkflowCustody
{
	/** Content-free manifest binding the operation and every ordered ciphertext row. */
	readonly manifest: GeneratedFileCustodyManifest;
	/** Ordered encrypted rows required by the custody codec. */
	readonly chunks: readonly SealedGeneratedFileChunk[];
}

/** Prisma adapter contract for validated generated-file state and encrypted custody reads. */
export interface GeneratedFileWorkflowRecordRepository
{
	/** Load one exact operation and reject invalid cross-owner relational state. */
	load(operationId: string, siloId?: string): Promise<GeneratedFileWorkflowRecord>;
	/** Load exact encrypted rows for a previously validated operation. */
	loadCustody(record: GeneratedFileWorkflowRecord): Promise<GeneratedFileWorkflowCustody>;
}
