import type { McpDiscoveredTool, McpToolCallResult } from "@opencrane/contracts";
import type { CanonicalJsonSha256Digest, JsonValue } from "@opencrane/util";

/** Authentication profiles that the remote transport may add in memory. */
export enum McpRemoteAuthorizationKinds
{
	/** Adds one ephemeral HTTP bearer token after protocol headers are built. */
	Bearer = "bearer",
}

/** Whether a failed operation is proven not to have reached the remote server. */
export enum McpRemoteDeliveryStates
{
	/** No request bytes could have reached the peer, so effect authority may close unused work. */
	ProvenNotDispatched = "proven_not_dispatched",
	/** Request bytes may have reached the peer, so an effectful call must not run automatically again. */
	MaybeDispatched = "maybe_dispatched",
}

/** Ephemeral transport authorization that must never enter durable protocol values. */
export interface McpRemoteAuthorization
{
	/** Selects the one supported authorization profile. */
	readonly kind: McpRemoteAuthorizationKinds.Bearer;
	/** Raw bearer material held only for this operation. */
	readonly token: string;
}

/** A reviewed network address that one HTTPS connection may use. */
export interface McpRemoteDnsAddress
{
	/** IPv4 or IPv6 address returned by the resolver. */
	readonly address: string;
	/** Address family reported by the resolver. */
	readonly family: 4 | 6;
}

/** Resolves an MCP endpoint host before the transport connects to it. */
export type McpRemoteDnsResolver = (hostname: string) => Promise<readonly McpRemoteDnsAddress[]>;

/** One HTTP request sent after its host has passed public-address validation. */
export interface McpRemoteHttpsRequestCommand
{
	/** HTTPS endpoint whose hostname remains the TLS server name. */
	readonly endpoint: URL;
	/** Reviewed address that the socket lookup must return without another DNS lookup. */
	readonly resolvedAddress: McpRemoteDnsAddress;
	/** JSON-RPC request bytes. */
	readonly body: Uint8Array;
	/** Headers required by the pinned MCP discovery exchange. */
	readonly headers: Readonly<Record<string, string>>;
	/** Deadline that covers connecting and reading the response. */
	readonly timeoutMilliseconds: number;
	/** Body limit that the request must enforce while reading the response. */
	readonly maximumResponseBytes: number;
	/** Cancels the socket when the complete probe deadline expires. */
	readonly signal: AbortSignal;
	/** Correlates the matching JSON-RPC response and permits early SSE closure. */
	readonly requestId: string;
	/** Bounded failure category used if response framing is invalid. */
	readonly malformedResponseCode: McpRemoteProtocolFailureCodes;
}

/** The bounded response returned by the low-level HTTPS request operation. */
export interface McpRemoteHttpsResponse
{
	/** HTTP status returned before the body is interpreted. */
	readonly status: number;
	/** Lower-cased HTTP response headers. */
	readonly headers: Readonly<Record<string, string | undefined>>;
	/** Bounded bytes through the final response; an SSE connection may still have been open. */
	readonly body: Uint8Array;
}

/** Sends one prevalidated HTTPS request; tests provide this function instead of opening a live socket. */
export type McpRemoteHttpsRequest = (command: McpRemoteHttpsRequestCommand) => Promise<McpRemoteHttpsResponse>;

/** Configures the production HTTPS remote client and its deterministic test overrides. */
export interface McpRemoteHttpsClientOptions
{
	/** Deadline applied to each complete remote exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Largest response admitted from an external server. */
	readonly maximumResponseBytes: number;
	/** Resolver override used by focused tests. */
	readonly resolve?: McpRemoteDnsResolver;
	/** HTTPS request override used by focused tests. */
	readonly request?: McpRemoteHttpsRequest;
}

/** Fields shared by every bounded request to one saved remote endpoint. */
export interface McpRemoteCommand
{
	/** Normalized HTTPS URL loaded from the saved MCP server. */
	readonly endpoint: string;
	/** Optional authorization material held only for this request. */
	readonly authorization?: McpRemoteAuthorization;
	/** Cancels the complete DNS, connect, write, and response operation. */
	readonly signal: AbortSignal;
}

/** One page requested from a remote server's tool catalogue. */
export interface McpRemoteToolsListCommand extends McpRemoteCommand
{
	/** Opaque continuation returned by the preceding page. */
	readonly cursor?: string;
}

/** One exact tool call whose arguments were admitted before this transport runs. */
export interface McpRemoteToolCallCommand extends McpRemoteCommand
{
	/** Stable ToolInvocation identifier used as the JSON-RPC request id. */
	readonly invocationId: string;
	/** Exact name saved with the selected tool revision. */
	readonly toolName: string;
	/** Canonical arguments already admitted by ToolInvocation authority. */
	readonly arguments: JsonValue;
	/** Frozen input schema used to construct permitted MCP parameter headers. */
	readonly inputSchema: JsonValue;
}

/** Evidence returned when a remote server completes the pinned discovery exchange. */
export interface McpRemoteDiscoveryResult
{
	/** MCP protocol revision the server declared in its JSON-RPC discovery result. */
	readonly protocolVersion: string;
	/** Digest of the validated JSON-RPC result stored as registration evidence. */
	readonly evidenceDigest: CanonicalJsonSha256Digest;
	/** Scope the peer requires for reuse of this discovery response. */
	readonly cacheScope: "private" | "public";
}

/** One validated page returned by `tools/list`. */
export interface McpRemoteToolsListResult
{
	/** Validated definitions returned by this page. */
	readonly tools: readonly McpDiscoveredTool[];
	/** Opaque continuation, or null when this is the final page. */
	readonly nextCursor: string | null;
	/** Scope the peer requires for reuse of this catalogue page. */
	readonly cacheScope: "private" | "public";
}

/** Bounded protocol failures that never retain a remote response. */
export type McpRemoteProtocolFailureCodes = "malformed_discovery" | "malformed_tools_list" | "malformed_tool_result";

/** Standard remote MCP operations with no registration or effect authority. */
export interface McpRemoteClient
{
	/** Check the pinned protocol without saving or authorizing the server. */
	discover(command: McpRemoteCommand): Promise<McpRemoteDiscoveryResult>;
	/** Read one validated tool page; the MCP domain owns pagination. */
	listTools(command: McpRemoteToolsListCommand): Promise<McpRemoteToolsListResult>;
	/** Execute one already-admitted tool call. */
	callTool(command: McpRemoteToolCallCommand): Promise<McpToolCallResult>;
}
