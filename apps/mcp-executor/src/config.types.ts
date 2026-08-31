/** Validated process configuration for one MCP companion Job. */
export interface McpExecutorProcessConfig
{
	/** Fixed cluster-local OpenCrane MCP executor endpoint. */
	readonly openCraneExecutorUrl: string;
	/** Fixed Pod-local uploaded MCP server endpoint. */
	readonly serverUrl: string;
	/** Absolute rotating projected-token path. */
	readonly tokenPath: string;
	/** Absolute mounted execution-reference path. */
	readonly referencePath: string;
	/** Immutable Kubernetes Pod UID supplied by the downward API. */
	readonly podUid: string;
	/** Per-request OpenCrane deadline. */
	readonly openCraneTimeoutMilliseconds: number;
	/** Per-request Pod-local MCP deadline. */
	readonly serverTimeoutMilliseconds: number;
	/** Maximum accepted claim bytes and outbound MCP request bytes. */
	readonly commandByteLimit: number;
	/** Maximum accepted MCP result and completion-report bytes. */
	readonly resultByteLimit: number;
	/** Maximum serialized terminal report after its identity and fence wrapper is added. */
	readonly reportByteLimit: number;
}
