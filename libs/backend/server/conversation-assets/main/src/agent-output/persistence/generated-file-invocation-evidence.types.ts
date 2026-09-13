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
	/** UID of the registered executor Job; the Pod UID remains a separate coordinate. */
	readonly workloadUid: string;
}

/** Current completion facts and the original strict result before ordinary terminal persistence. */
export interface GeneratedFileInvocationResultCommand extends GeneratedFileInvocationEvidence
{
	/** Original wire result whose replay digest remains owned by MCP. */
	readonly result: McpToolCallResult;
}

/** Binds encrypted capture to the existing completion transaction and its freshly checked authority. */
export interface GeneratedFileCaptureRepositoryFactory
{
	/** Construct capture on the same transaction that loaded the invocation and will save its result. */
	(currentExecution: GeneratedFileCurrentExecutionAuthority): GeneratedFileCaptureRepository;
}
