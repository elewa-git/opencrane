import type { JsonValue } from "@opencrane/util";
import type { Logger } from "@opencrane/backend/observability";
import type { McpExecutorDiscoveredTool, McpExecutorToolCallResult } from "@opencrane/backend/agents/runtime/mcp-executor/protocol";

/**
 * Selects the operation that a companion may perform under one server-issued fence.
 *
 * OpenCrane sends these string values to the Pod and requires the same value in its completion.
 * The wire parser rejects unknown values; changing either value breaks the companion API.
 */
export enum McpCompanionCommandKinds
{
	/** Discover the pinned protocol revision and return the live tool list. */
	Discovery = "discovery",
	/** Call one server-approved tool with the exact reviewed arguments. */
	Invocation = "invocation",
}

/**
 * Classifies a companion failure without sending provider errors or response data to OpenCrane.
 *
 * The wire parser accepts this closed set, and the runtime uses the command kind to decide whether
 * the failure is definite discovery failure or an invocation that requires manual recovery.
 */
export enum McpCompanionFailureCodes
{
	/** The server did not complete discovery and tool listing through the pinned protocol. */
	DiscoveryFailed = "discovery_failed",
	/** The server did not return one checked tool-call result. */
	ToolCallFailed = "tool_call_failed",
}

/**
 * Reports how the one-shot companion process ended to its app entry point.
 *
 * These values stay in process memory: the server persists command and workload states instead.
 * The entry point exits normally for every member, while thrown transport errors remain fatal.
 */
export enum McpCompanionRunOutcomes
{
	/** Authority had no command for this exact Pod. */
	Idle = "idle",
	/** The checked discovery or tool-call result was accepted. */
	Completed = "completed",
	/** A bounded failure was accepted for the claimed command. */
	Failed = "failed",
	/** OpenCrane reported that the saved work had already ended before this Pod claimed it. */
	Stopped = "stopped",
}

/**
 * Tells the companion why a successful claim response contains no command.
 *
 * OpenCrane maps this wire value to HTTP 410, and the companion stops polling when it receives it.
 * The claim parser rejects any other non-command value.
 */
export enum McpCompanionRemoteClaimOutcomes
{
	/** The server closed the execution before dispatch, so polling must stop. */
	Terminal = "terminal",
}

/** Coordinates one server-issued command through its current claim fence. */
export interface McpCompanionCommandLease
{
	/** Stable saved execution identifier echoed by terminal reports. */
	readonly executionId: string;
	/** Opaque server-issued value that rejects stale completion and failure writes. */
	readonly claimFence: string;
	/** Server time after which this process must refuse to execute the command. */
	readonly expiresAt: string;
}

/** Requests live discovery from the uploaded MCP server. */
export interface McpCompanionDiscoveryCommand
{
	/** Selects the discovery exchange. */
	readonly kind: McpCompanionCommandKinds.Discovery;
	/** Current fenced authority for this exchange. */
	readonly lease: McpCompanionCommandLease;
}

/** Requests one previously admitted tool call from the uploaded MCP server. */
export interface McpCompanionToolCallCommand
{
	/** Selects one tool call. */
	readonly kind: McpCompanionCommandKinds.Invocation;
	/** Current fenced authority for this exchange. */
	readonly lease: McpCompanionCommandLease;
	/** ToolInvocation identifier used as the matching MCP JSON-RPC id. */
	readonly invocationId: string;
	/** Exact live MCP tool name selected by server authority. */
	readonly toolName: string;
	/** Exact reviewed arguments admitted by ToolInvocation authority. */
	readonly arguments: JsonValue;
}

/** One server-issued operation this one-shot process may execute. */
export type McpCompanionCommand = McpCompanionDiscoveryCommand | McpCompanionToolCallCommand;

/** Binds every OpenCrane request to the projected workload and Kubernetes Pod. */
export interface McpCompanionIdentity
{
	/** Opaque database-issued reference projected into the companion container. */
	readonly executionReference: string;
	/** Immutable Kubernetes Pod UID supplied by the downward API. */
	readonly podUid: string;
}

/** Carries checked discovery data back through the current command fence. */
export interface McpCompanionDiscoveryCompletion
{
	/** Identifies the completed exchange as discovery. */
	readonly kind: McpCompanionCommandKinds.Discovery;
	/** Live tool definitions checked by the pinned MCP protocol parser. */
	readonly tools: readonly McpExecutorDiscoveredTool[];
}

/** Carries one checked MCP tool result back through the current command fence. */
export interface McpCompanionToolCallCompletion
{
	/** Identifies the completed exchange as a tool call. */
	readonly kind: McpCompanionCommandKinds.Invocation;
	/** Validated MCP content blocks and the provider's explicit tool-error flag. */
	readonly result: McpExecutorToolCallResult;
}

/** One checked completion accepted by the OpenCrane authority. */
export type McpCompanionCompletion = McpCompanionDiscoveryCompletion | McpCompanionToolCallCompletion;

/** OpenCrane operations available to the isolated companion. */
export interface McpCompanionRemote
{
	/** Claim at most one command for the exact projected reference and Pod UID. */
	claim(identity: McpCompanionIdentity, signal: AbortSignal): Promise<McpCompanionCommand | McpCompanionRemoteClaimOutcomes.Terminal | null>;
	/** Submit checked data through the exact command fence. */
	complete(identity: McpCompanionIdentity, lease: McpCompanionCommandLease, completion: McpCompanionCompletion, signal: AbortSignal): Promise<void>;
	/** Submit one stable failure code through the exact command fence. */
	fail(identity: McpCompanionIdentity, lease: McpCompanionCommandLease, failureCode: McpCompanionFailureCodes, signal: AbortSignal): Promise<void>;
}

/** Pod-local MCP operations available to the process orchestrator. */
export interface McpCompanionServer
{
	/** Wait for the uploaded server to answer pinned discovery before OpenCrane work is claimed. */
	ready(signal: AbortSignal): Promise<void>;
	/** Complete pinned protocol discovery before returning checked live tools. */
	discover(signal: AbortSignal): Promise<readonly McpExecutorDiscoveredTool[]>;
	/** Execute exactly one server-authorized tool call. */
	call(command: McpCompanionToolCallCommand, signal: AbortSignal): Promise<McpExecutorToolCallResult>;
}

/** Fetch-compatible seam injected into HTTP adapters for focused tests. */
export type McpCompanionFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads a rotating projected token immediately before an OpenCrane request. */
export type McpCompanionTokenReader = () => Promise<string>;

/** Settings for the authenticated OpenCrane command adapter. */
export interface McpCompanionRemoteOptions
{
	/** Fixed credential-free cluster-local endpoint ending in `/api/internal/mcp-executor`. */
	readonly openCraneExecutorUrl: string;
	/** Absolute path of the rotating projected ServiceAccount token. */
	readonly tokenPath: string;
	/** Per-request deadline in milliseconds. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum accepted command response bytes. */
	readonly maximumResponseBytes: number;
	/** Maximum completion or failure request bytes. */
	readonly maximumRequestBytes: number;
	/** Optional fetch replacement used by focused tests. */
	readonly fetch?: McpCompanionFetch;
	/** Optional projected-token reader used by focused tests. */
	readonly readToken?: McpCompanionTokenReader;
}

/** Settings for the Pod-local uploaded MCP server adapter. */
export interface McpCompanionServerOptions
{
	/** Fixed loopback MCP endpoint supplied by the Job launcher. */
	readonly serverUrl: string;
	/** Per-request deadline in milliseconds. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum serialized MCP request bytes. */
	readonly maximumRequestBytes: number;
	/** Maximum accepted MCP response bytes. */
	readonly maximumResponseBytes: number;
	/** Optional fetch replacement used by focused tests. */
	readonly fetch?: McpCompanionFetch;
}

/** Dependencies for one complete companion process run. */
export interface McpCompanionDependencies
{
	/** Authenticated server authority for claim and terminal reports. */
	readonly remote: McpCompanionRemote;
	/** Pod-local transport for the uploaded MCP server. */
	readonly server: McpCompanionServer;
	/** Structured logger that never receives references, arguments, or results. */
	readonly log: Logger;
}
