import type { JsonValue } from "@opencrane/util";
import type { McpExecutorDiscoveredTool, McpExecutorToolCallResult } from "@opencrane/backend/agents/runtime/mcp-executor/protocol";

import type { McpCompanionCommandKinds, McpCompanionFailureCodes } from "./mcp-companion.types";

/** Identifies one runtime-created companion without granting authority by itself. */
export interface McpCompanionClaimRequest
{
	/** Opaque reference projected from the saved workload claim. */
	readonly executionReference: string;
	/** Immutable Kubernetes Pod UID bound by server-side TokenReview evidence. */
	readonly podUid: string;
}

/** Fields every server-issued companion execution carries through its terminal report. */
export interface McpCompanionClaimLease
{
	/** Stable identifier of the saved execution selected by server authority. */
	readonly executionId: string;
	/** Opaque fence that rejects a stale or repeated delivery. */
	readonly claimFence: string;
	/** Server timestamp after which execution must fail closed. */
	readonly expiresAt: string;
}

/** Commands the companion to discover the pinned MCP revision and live tools. */
export interface McpCompanionDiscoveryClaim extends McpCompanionClaimLease
{
	/** Selects discovery as the only permitted exchange. */
	readonly kind: McpCompanionCommandKinds.Discovery;
}

/** Commands the companion to make one already-authorized MCP tool call. */
export interface McpCompanionInvocationClaim extends McpCompanionClaimLease
{
	/** Selects one tool call as the only permitted exchange. */
	readonly kind: McpCompanionCommandKinds.Invocation;
	/** ToolInvocation identifier used as the matching MCP JSON-RPC id. */
	readonly invocationId: string;
	/** Exact tool name selected by server authority. */
	readonly toolName: string;
	/** Exact reviewed arguments admitted by ToolInvocation authority. */
	readonly arguments: JsonValue;
}

/** Complete strict response returned by `POST /claim`. */
export type McpCompanionClaimResponse = McpCompanionDiscoveryClaim | McpCompanionInvocationClaim;

/** Coordinates a terminal write with the projected workload and current execution fence. */
export interface McpCompanionTerminalRequest
{
	/** Opaque reference projected from the saved workload claim. */
	readonly executionReference: string;
	/** Immutable Kubernetes Pod UID bound by server-side TokenReview evidence. */
	readonly podUid: string;
	/** Stable saved execution identifier returned by the claim. */
	readonly executionId: string;
	/** Opaque claim fence returned by the same delivery. */
	readonly claimFence: string;
}

/** Carries checked live tool definitions from a discovery execution. */
export interface McpCompanionDiscoveryResult
{
	/** Identifies the payload as a discovery completion. */
	readonly kind: McpCompanionCommandKinds.Discovery;
	/** Tool definitions checked by the pinned MCP protocol parser. */
	readonly tools: readonly McpExecutorDiscoveredTool[];
}

/** Carries one checked result from an authorized tool invocation. */
export interface McpCompanionInvocationResult
{
	/** Identifies the payload as an invocation completion. */
	readonly kind: McpCompanionCommandKinds.Invocation;
	/** Result checked by the pinned MCP protocol parser. */
	readonly result: McpExecutorToolCallResult;
}

/** Strict request accepted by `POST /complete`. */
export interface McpCompanionCompletionRequest extends McpCompanionTerminalRequest
{
	/** Checked discovery or invocation data. */
	readonly completion: McpCompanionDiscoveryResult | McpCompanionInvocationResult;
}

/** Strict request accepted by `POST /fail`. */
export interface McpCompanionFailureRequest extends McpCompanionTerminalRequest
{
	/** Stable code only; provider errors and response data never cross this boundary. */
	readonly failureCode: McpCompanionFailureCodes;
}
