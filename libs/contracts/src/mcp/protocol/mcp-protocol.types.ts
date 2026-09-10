import type { JsonValue } from "@opencrane/util";

/** A stateless MCP 2026-07-28 JSON-RPC request before a transport serializes it. */
export interface McpRequest
{
	/** Selects JSON-RPC 2.0. */
	readonly jsonrpc: "2.0";
	/** Correlates the response with this request. */
	readonly id: string;
	/** Names the MCP operation. */
	readonly method: string;
	/** Carries operation input and the required per-request metadata. */
	readonly params: JsonValue;
}

/** The completed result returned by `server/discover`. */
export interface McpDiscoveryResult
{
	/** Allows validated standard and extension fields to remain available to the caller. */
	readonly [key: string]: JsonValue;
	/** Marks this response as complete rather than requiring another client round trip. */
	readonly resultType: "complete";
	/** Lists protocol revisions offered by the server. */
	readonly supportedVersions: readonly string[];
	/** Describes the operations and notifications implemented by the server. */
	readonly capabilities: Readonly<Record<string, JsonValue>>;
	/** Gives the cache lifetime in integer milliseconds. */
	readonly ttlMs: number;
	/** Limits reuse of discovery evidence to the stated authorization scope. */
	readonly cacheScope: "public" | "private";
}

/** The durable tool definition OpenCrane keeps after validating a server response. */
export interface McpDiscoveredTool
{
	/** Names the tool in a later `tools/call` request. */
	readonly name: string;
	/** Describes the tool, or null when the server omitted the description. */
	readonly description: string | null;
	/** Defines the arguments accepted by the tool. */
	readonly inputSchema: JsonValue;
}

/** One page returned by `tools/list`. */
export interface McpToolsListResult
{
	/** Contains validated tool definitions from this page. */
	readonly tools: readonly McpDiscoveredTool[];
	/** Continues pagination, or null when this is the last page. */
	readonly nextCursor: string | null;
}

/** The durable result of a completed MCP tool call. */
export interface McpToolCallResult
{
	/** Reports a tool-level error that remains valid result data. */
	readonly isError: boolean;
	/** Contains validated MCP content blocks. */
	readonly content: readonly JsonValue[];
	/** Preserves structured output when the server supplied it. */
	readonly structuredContent?: JsonValue;
}

/** Reports malformed or unsupported MCP 2026-07-28 wire data. */
export class McpProtocolError extends Error
{
	/** Creates a stable protocol error without retaining peer-controlled payloads. */
	constructor(message: string)
	{
		super(message);
		this.name = "McpProtocolError";
	}
}
