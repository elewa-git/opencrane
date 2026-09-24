import type { McpToolInvocationTransactionParticipant, ProductAuthorizationWorkloadContext, ToolInvocationClaim } from "@opencrane/backend/server/iam/authorization";
import type { McpRemoteClient } from "@opencrane/backend/server/infra/mcp-remote-client";
import type { McpToolCallResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { McpConnectionCredentialReader } from "../connections/mcp-connection-credential-reader.types";
import type { McpConnectionRecord } from "../connections/mcp-connection.types";
import type { McpServerWorkloadIdentityReader } from "../server-identity/mcp-server-workload.types";

/** Stable outcomes returned when an existing workflow asks MCP to progress one invocation. */
export enum McpInvocationDispatchOutcomes
{
	/** An OCI companion owns this invocation, so the server must only wait for its result. */
	AwaitingOciCompanion = "awaiting_oci_companion",
	/** The remote call and its terminal ToolInvocation projection committed. */
	Completed = "completed",
	/** Existing durable state already prevents another provider call. */
	Terminal = "terminal",
}

/** Selects the durable owner coordinates used to resolve one public tool call; this lookup choice is not persisted. */
export enum McpInvocationOwnerKinds
{
	/** The lookup must match one AgentRun attempt before dispatch. */
	Run = "run",
	/** The lookup must match one caller-owned MCP task before dispatch. */
	McpTask = "mcp_task",
}

/** Public invocation identity resolved to a database row only inside MCP persistence. */
export type McpInvocationDispatchTarget =
	| { readonly ownerKind: McpInvocationOwnerKinds.Run; readonly siloId: string; readonly runId: string; readonly attempt: number; readonly toolInvocationId: string }
	| { readonly ownerKind: McpInvocationOwnerKinds.McpTask; readonly siloId: string; readonly mcpTaskId: string; readonly toolInvocationId: string };

/** Remote connection fields frozen before any provider effect may begin. */
export interface RemoteMcpExecutionBinding
{
	/** Silo that owns the connection, revision, invocation, and runtime row. */
	readonly siloId: string;
	/** Identifies the exact connection generation selected during admission. */
	readonly connectionId: string;
	/** Prevents a replacement generation from receiving this invocation. */
	readonly connectionGeneration: number;
	/** Principal whose current connection permission must be rechecked. */
	readonly connectionOwnerPrincipalId: string;
	/** Detects a changed registered endpoint before dispatch. */
	readonly endpointDigest: string;
	/** Identifies the immutable discovered server revision. */
	readonly serverRevisionId: string;
	/** Identifies the registered server that owns the connection and revision. */
	readonly mcpServerId: string;
	/** Identifies the schema-validated tool revision. */
	readonly toolRevisionId: string;
	/** Protocol version frozen by authenticated discovery. */
	readonly protocolVersion: string;
	/** Secret UID frozen with a bearer connection, otherwise null. */
	readonly credentialSecretUid: string | null;
	/** Secret resource version paired with the UID, otherwise null. */
	readonly credentialSecretResourceVersion: string | null;
}

/** Command returned only after the connection and ToolInvocation claims commit together. */
export interface RemoteMcpDispatchClaim
{
	/** Runtime row whose remote fence authorizes this one execution attempt. */
	readonly executionId: string;
	/** Earliest database-issued remote or IAM claim deadline for every remaining local and provider step. */
	readonly notAfterEpochMs: number;
	/** Remaining database-measured claim allowance anchored locally before the claiming transaction starts. */
	readonly remainingClaimMilliseconds: number;
	/** Opaque fence saved before any Secret read or network operation. */
	readonly remoteClaimFence: string;
	/** Existing authorization-owned provider claim. */
	readonly toolInvocationClaim: ToolInvocationClaim;
	/** Frozen connection and revision coordinates supplied to credential custody. */
	readonly binding: RemoteMcpExecutionBinding;
	/** Registered HTTPS endpoint whose digest matched the binding during claim. */
	readonly endpoint: string;
	/** Exact discovered tool name. */
	readonly toolName: string;
	/** Saved effective arguments checked by ToolInvocation authority. */
	readonly arguments: JsonValue;
	/** Frozen schema used by the remote client to build parameter headers. */
	readonly inputSchema: JsonValue;
}

/** Results of the transaction that tries to claim one remote call. */
export enum RemoteMcpDispatchClaimOutcomes
{
	/** The invocation belongs to the existing OCI companion path. */
	NotRemote = "not_remote",
	/** A RemoteHttp invocation needs verified server identity before its claim transaction. */
	IdentityRequired = "identity_required",
	/** This call committed both required provider-effect fences. */
	Claimed = "claimed",
	/** Current authority denied dispatch and the invocation was closed without provider I/O. */
	Denied = "denied",
	/** The invocation already has a terminal or previous remote claim winner. */
	Terminal = "terminal",
	/** Saved runtime evidence is temporarily unavailable or internally inconsistent. */
	Unavailable = "unavailable",
}

/** Flat claim result that carries provider input only for the new claim winner. */
export interface RemoteMcpDispatchClaimResult
{
	/** Tells the executor whether it may perform one remote request. */
	readonly outcome: RemoteMcpDispatchClaimOutcomes;
	/** Present only when this transaction newly committed the remote claim. */
	readonly claim?: RemoteMcpDispatchClaim;
}

/** Current server identity used for effect authorization, never accepted from a request. */
export interface RemoteMcpDispatchCommand
{
	/** Saved owner coordinates and public call id selected by the workflow. */
	readonly target: McpInvocationDispatchTarget;
	/** TokenReview-confirmed server identity, supplied only after RemoteHttp is selected. */
	readonly workload?: ProductAuthorizationWorkloadContext;
}

/** Transaction owner for remote provider claims and terminal ToolInvocation writes. */
export interface RemoteMcpDispatchAuthority
{
	/** Claim one remote effect or return the saved strategy winner without provider I/O. */
	claim(command: RemoteMcpDispatchCommand): Promise<RemoteMcpDispatchClaimResult>;
	/** Save a checked result through the existing ToolInvocation lifecycle. */
	completeSucceeded(claim: RemoteMcpDispatchClaim, result: McpToolCallResult): Promise<boolean>;
	/** Save a failure proven to have happened before provider dispatch. */
	completeFailed(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>;
	/** Save manual recovery when the remote server may have received the request. */
	completeAmbiguous(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>;
	/** Close one remote invocation after its owning workflow reaches its final retry. */
	settleExhausted(target: McpInvocationDispatchTarget): Promise<boolean>;
}

/** Transaction-scoped operations used by the remote dispatch unit of work. */
export interface RemoteMcpDispatchRepository
{
	/** Claim one invocation while the caller's Prisma transaction remains open. */
	claim(target: McpInvocationDispatchTarget, workload?: ProductAuthorizationWorkloadContext): Promise<RemoteMcpDispatchClaimResult>;
	/** Save a checked result in the same transaction as its ToolInvocation projection. */
	completeSucceeded(claim: RemoteMcpDispatchClaim, result: McpToolCallResult): Promise<boolean>;
	/** Save a failure known to precede provider dispatch. */
	completeFailed(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>;
	/** Save manual recovery when the provider may have received the request. */
	completeAmbiguous(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>;
	/** Close unused work or preserve an unresolved remote effect as RecoveryRequired. */
	settleExhausted(target: McpInvocationDispatchTarget): Promise<boolean>;
}

/** Transaction-scoped owner for revocation settlement of remote invocations. */
export interface RemoteMcpConnectionExecutionSettlementRepository
{
	/** Close unused work and report whether no committed dispatch remains open. */
	isSettled(record: McpConnectionRecord, toolInvocations: McpToolInvocationTransactionParticipant): Promise<boolean>;
}

/** Dependencies for the server-mediated remote invocation executor. */
export interface RemoteMcpInvocationExecutorDependencies
{
	/** Owns every database transition around the external effect. */
	readonly authority: RemoteMcpDispatchAuthority;
	/** TokenReview-checks the current server Pod before every new claim. */
	readonly serverIdentity: McpServerWorkloadIdentityReader;
	/** Reads exact credential material only after the provider claim commits. */
	readonly credentials: McpConnectionCredentialReader;
	/** Sends one bounded standard MCP request after all durable guards commit. */
	readonly client: Pick<McpRemoteClient, "callTool">;
	/** Bounds the remote HTTP operation after the connection reader returns. */
	readonly timeoutMilliseconds: number;
}

/** Common workflow port for OCI waiting and server-mediated remote execution. */
export interface McpInvocationExecutor
{
	/** Progress one admitted invocation without repeating a saved provider claim. */
	execute(target: McpInvocationDispatchTarget): Promise<McpInvocationDispatchOutcomes>;
	/** Close the invocation when its durable workflow has no retry left. */
	settleExhausted(target: McpInvocationDispatchTarget): Promise<boolean>;
}
