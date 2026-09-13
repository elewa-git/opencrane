import { McpConnectionStatus, McpCredentialRequirement } from "@opencrane/contracts";

import { McpConnectionStates } from "./mcp-connection.types";

/** Execution strategies understood by the connection readiness owner. */
export enum McpConnectionReadinessTransports
{
	/** A credentialless OCI revision executes in an isolated companion workload. */
	OciImage = "oci-image",
	/** A remote revision executes through its active connection generation. */
	RemoteHttp = "remote-http",
}

/** Coordinates that bind one MCP tool to the Principal whose current installation may authorize dispatch. */
export interface McpConnectionReadinessCommand
{
	/** Silo containing the tool, server and installation. */
	readonly siloId: string;
	/** Immutable tool revision selected for this effect. */
	readonly toolRevisionId: string;
	/** Personal or managed-service Principal that will perform the effect. */
	readonly ownerPrincipalId: string;
}

/** Reads and locks the current OCI or remote installation for one MCP effect. */
export interface McpConnectionReadiness
{
	/** Return true for a credentialless OCI install or its exact active remote connection generation. */
	isReady(command: McpConnectionReadinessCommand): Promise<boolean>;
	/** Lock the same ready install against uninstall without changing its projected connection state. */
	lockForDispatch(command: McpConnectionReadinessCommand): Promise<boolean>;
}

/** Saved connection coordinates selected with one Ready remote or OCI revision. */
export interface McpConnectionReadinessRevision
{
	/** Execution strategy frozen on the discovered revision. */
	readonly transport: McpConnectionReadinessTransports;
	/** Connection record selected for a remote revision, or null for OCI. */
	readonly connectionId: string | null;
	/** Connection generation selected for a remote revision, or null for OCI. */
	readonly connectionGeneration: number | null;
	/** Principal that owns the selected remote connection, or null for OCI. */
	readonly connectionOwnerPrincipalId: string | null;
	/** Digest of the remote endpoint selected by discovery, or null for OCI. */
	readonly endpointDigest: string | null;
	/** Current connection row used to verify every saved remote coordinate. */
	readonly connection: {
		readonly id: string;
		readonly mcpServerInstallId: string;
		readonly ownerPrincipalId: string;
		readonly generation: number;
		readonly endpointDigest: string;
		readonly state: McpConnectionStates;
	} | null;
}

/** Installation and server facts read together before an MCP effect is admitted or claimed. */
export interface McpConnectionReadinessTarget
{
	/** Installation row locked against uninstall before dispatch. */
	readonly id: string;
	/** Server whose current governance and revision were selected. */
	readonly mcpServerId: string;
	/** Principal that owns the installation and any remote connection. */
	readonly principalId: string;
	/** Installation state preserved when its row is locked. */
	readonly connectionStatus: McpConnectionStatus;
	/** Current server requirement and the selected Ready revision. */
	readonly mcpServer: {
		readonly credentialRequirement: McpCredentialRequirement;
		readonly revisions: readonly McpConnectionReadinessRevision[];
	};
}
