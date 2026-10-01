import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { McpToolCallResult } from "@opencrane/contracts";

import type { GeneratedFileCaptureProof, GeneratedFileCaptureRepository, GeneratedFileCurrentExecutionAuthority } from "./generated-file-capture.types";

/** MCP-owned facts loaded while the exact companion completion claim is current. */
export interface GeneratedFileInvocationEvidence extends GeneratedFileCaptureProof
{
	/** Current claimed invocation returned by the IAM participant on this transaction. */
	readonly invocation: ToolInvocationRecord;
	/** Original companion deadline, which capture cannot extend. */
	readonly companionNotAfterEpochMs: number;
	/** Immutable server revision that owns the selected tool. */
	readonly serverRevisionId: string;
	/** IAM claim saved on the current MCP execution. */
	readonly toolClaim: ToolInvocationClaim;
	/** Name loaded from the selected immutable tool revision. */
	readonly toolName: string;
	/** Remote fences never impersonate an OCI companion. */
	readonly remoteClaimFence?: never;
	/** UID of the registered executor Job; the Pod UID remains a separate coordinate. */
	readonly workloadUid: string;
}

/** Server-mediated completion facts that carry no OCI companion or workload coordinates. */
export interface GeneratedFileRemoteInvocationEvidence
{
	/** Runtime row whose remote fence authorized the provider request. */
	readonly executionId: string;
	/** Exact claimed invocation returned by the IAM participant on this transaction. */
	readonly invocation: ToolInvocationRecord;
	/** Opaque remote fence saved before credential or provider access. */
	readonly remoteClaimFence: string;
	/** Original remote claim expiry, which result handling cannot extend. */
	readonly remoteNotAfterEpochMs: number;
	/** Immutable server revision that owns the selected tool. */
	readonly serverRevisionId: string;
	/** Silo that owns the execution and invocation. */
	readonly siloId: string;
	/** IAM claim saved on the current MCP execution. */
	readonly toolClaim: ToolInvocationClaim;
	/** Name loaded from the selected immutable tool revision. */
	readonly toolName: string;
}

/** Original strict result retained until source-specific resource handling succeeds. */
interface GeneratedFileInvocationRawResult
{
	/** Original wire result whose replay digest remains owned by MCP. */
	readonly result: McpToolCallResult;
}

/** Current completion facts and original result for either OCI or server-mediated execution. */
export type GeneratedFileInvocationResultCommand = (GeneratedFileInvocationEvidence | GeneratedFileRemoteInvocationEvidence) & GeneratedFileInvocationRawResult;

/** Binds encrypted capture to the existing completion transaction and its freshly checked authority. */
export interface GeneratedFileCaptureRepositoryFactory
{
	/** Construct capture on the same transaction that loaded the invocation and will save its result. */
	(currentExecution: GeneratedFileCurrentExecutionAuthority): GeneratedFileCaptureRepository;
}
