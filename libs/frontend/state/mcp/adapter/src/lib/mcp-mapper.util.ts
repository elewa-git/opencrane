import { McpAccessPolicy, McpApprovalStatus, McpConnectionStatus, McpCredentialField, McpDirectory, McpEntitledGroup, McpEntitledUser, McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";

/**
 * Wire shapes + mappers for the live OpenCrane MCP gateway.
 *
 * Local projections of the `/api/v1/mcp/...` JSON — WeOwnAI never imports
 * OpenCrane source. Enum-bearing fields arrive as raw strings, so the mappers
 * coerce them through the known enum values (with a safe default) and fill
 * missing collections, so every field on the read models is always set — components never see undefined.
 */

/** Wire shape of a catalogue server. */
export interface McpServerWire
{
	/** Stable id / slug. */
	id: string;
	/** Display name. */
	name?: string;
	/** Short description. */
	description?: string;
	/** Publisher label. */
	publisher?: string;
	/** Tile glyph. */
	glyph?: string;
	/** Connection type (raw string). */
	type?: string;
	/** Lifecycle status (raw string). */
	approvalStatus?: string;
	/** Credential fields. */
	credentialSchema?: McpCredentialField[];
	/** Entitlement summary. */
	entitlementSummary?: string;
}

/** Wire shape of an installed-server record. */
export interface McpInstalledWire
{
	/** Catalogue server id. */
	serverId: string;
	/** Connection status (raw string). */
	connectionStatus?: string;
	/** Relative last-used label. */
	lastUsed?: string | null;
	/** Connected OAuth account. */
	connectedAccount?: string;
}

/** Wire shape of an access policy. */
export interface McpAccessPolicyWire
{
	/** Server id. */
	serverId: string;
	/** Entitled groups. */
	groups?: McpEntitledGroup[];
	/** Entitled users. */
	users?: McpEntitledUser[];
}

/** Coerce a raw string into a {@link McpServerType}, defaulting to single-user. */
function _ToServerType(raw: string | undefined): McpServerType
{
	const match = Object.values(McpServerType).find(function eq(value: McpServerType): boolean { return value === raw; });
	return match ?? McpServerType.SingleUser;
}

/** Coerce a raw string into a {@link McpApprovalStatus}, defaulting to pending. */
function _ToApprovalStatus(raw: string | undefined): McpApprovalStatus
{
	const match = Object.values(McpApprovalStatus).find(function eq(value: McpApprovalStatus): boolean { return value === raw; });
	return match ?? McpApprovalStatus.PendingReview;
}

/** Coerce a raw string into a {@link McpConnectionStatus}, defaulting to needs-credential. */
function _ToConnectionStatus(raw: string | undefined): McpConnectionStatus
{
	const match = Object.values(McpConnectionStatus).find(function eq(value: McpConnectionStatus): boolean { return value === raw; });
	return match ?? McpConnectionStatus.NeedsCredential;
}

/** Map a wire server onto the {@link McpServer} read model. */
export function _MapServer(wire: McpServerWire): McpServer
{
	return {
		id: wire.id,
		name: wire.name ?? wire.id,
		description: wire.description ?? "",
		publisher: wire.publisher ?? "",
		glyph: wire.glyph ?? wire.id.slice(0, 2),
		type: _ToServerType(wire.type),
		approvalStatus: _ToApprovalStatus(wire.approvalStatus),
		credentialSchema: wire.credentialSchema ?? [],
		entitlementSummary: wire.entitlementSummary ?? ""
	};
}

/** Map a wire installed record onto the {@link McpInstalledServer} read model. */
export function _MapInstalled(wire: McpInstalledWire): McpInstalledServer
{
	return {
		serverId: wire.serverId,
		connectionStatus: _ToConnectionStatus(wire.connectionStatus),
		lastUsed: wire.lastUsed ?? null,
		connectedAccount: wire.connectedAccount
	};
}

/** Map a wire access policy onto the {@link McpAccessPolicy} read model. */
export function _MapAccessPolicy(wire: McpAccessPolicyWire): McpAccessPolicy
{
	return {
		serverId: wire.serverId,
		groups: wire.groups ?? [],
		users: wire.users ?? []
	};
}

/** Map a wire directory onto the {@link McpDirectory} read model. */
export function _MapDirectory(wire: { users?: McpEntitledUser[]; groups?: McpEntitledGroup[] }): McpDirectory
{
	return { users: wire.users ?? [], groups: wire.groups ?? [] };
}
