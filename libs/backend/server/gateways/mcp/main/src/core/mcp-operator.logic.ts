import { McpApprovalStatus, McpConnectionStatus, McpServerType, McpToolRevisionEligibility, McpToolRevisionReadiness, type CredentialField, type McpAssignableToolRevision, type McpCatalogServer, type McpInstalled } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___CloneCanonicalJson, ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import type { McpOperatorCaller } from "./mcp-operator.logic.types";
import type { McpOperatorInstallRecord, McpOperatorServerRecord, McpOperatorTransaction, McpOperatorUnitOfWork } from "./mcp-operator-repository.types";
import { __McpEraProbeRequiredStates } from "../era-probe/mcp-era-probe-state";
import { __RequireMcpOrganizationAdministration, __RequireMcpOrganizationAdministrationRead } from "./mcp-operator-authorization";

const _TYPE = { SingleUser: McpServerType.SingleUser, MultiUser: McpServerType.MultiUser, RemoteOauth: McpServerType.RemoteOauth } as const;
const _APPROVAL = { PendingReview: McpApprovalStatus.PendingReview, Approved: McpApprovalStatus.Approved, Published: McpApprovalStatus.Published, Disabled: McpApprovalStatus.Disabled } as const;
const _REQUIRED_APPROVAL = { Approved: "PendingReview", Published: "Approved" } as const;
const _CONNECTION = { NeedsCredential: McpConnectionStatus.NeedsCredential, SharedKey: McpConnectionStatus.SharedKey } as const;
/** Marks the persisted server state that permits a tool assignment. */
const _ASSIGNABLE_SERVER_STATUS = { Active: true, Degraded: false, Draft: false } as const;
/** Marks the persisted revision state that has frozen tool schemas. */
const _READY_REVISION_STATE = { Discovering: false, Ready: true, Rejected: false } as const;

/**
 * Lists published MCP catalog entries that the caller's persisted authorization grants allow.
 *
 * A published row is not enough to appear in the catalog: the transaction-bound authority checks
 * the typed MCP-server `Discover` action across the local Principal's stored personal and Group
 * boundaries. One batch decision covers every lifecycle-eligible row.
 *
 * Called by: {@link mcpOperatorRouter} for `GET /catalog`.
 * @param unitOfWork - Runs the catalog read and authorization decisions in one operation.
 * @param caller - Supplies the authenticated silo and local Principal to authorize.
 * @returns Published catalog entries that have an allow decision; otherwise an empty array.
 */
export function listEntitledCatalog(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller): Promise<McpCatalogServer[]>
{
	return unitOfWork.execute(async function _List(transaction)
	{
		const servers = await transaction.mcp.listPublishedServers(caller.siloId);
		const entitled = await transaction.authorization.listPrincipalEntitled({
			siloId: caller.siloId,
			principalId: caller.principalId,
			action: ProductAuthorizationActions.Discover,
			resources: servers.map(server => ({ kind: ProductAuthorizationResourceKinds.McpServer, id: server.id })),
			nowEpochMs: Date.now(),
		});
		const entitledIds = new Set(entitled.map(resource => resource.id));
		return servers.filter(server => entitledIds.has(server.id)).map(_MapServer);
	});
}

/**
 * Lists every MCP catalog row in the authenticated caller's silo for governance.
 *
 * Unlike {@link listEntitledCatalog}, this view includes unpublished rows because its route is
 * already requires the caller's current Organization/Administer grant; the silo still prevents it
 * from reading another organization's catalog.
 *
 * Called by: {@link mcpOperatorRouter} for `GET /servers`.
 * @param unitOfWork - Runs the silo-scoped catalog read.
 * @param caller - Supplies the authenticated silo.
 * @returns All catalog entries in the caller's silo.
 */
export function listAllServers(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller): Promise<McpCatalogServer[]>
{
	return unitOfWork.execute(async function _List(transaction)
	{
		await __RequireMcpOrganizationAdministrationRead(transaction.authorization, caller);
		return (await transaction.mcp.listAllServers(caller.siloId)).map(_MapServer);
	});
}

/**
 * Lists the MCP servers installed for one local Principal.
 *
 * The route resolves the external identity to this persisted Principal before calling the flow, so
 * the result cannot use another principal's installation rows.
 *
 * Called by: {@link mcpOperatorRouter} for `GET /installed`.
 * @param unitOfWork - Runs the installation read.
 * @param principalId - Identifies the local Principal whose installations to return.
 * @returns The principal's installed servers and their persisted connection states.
 */
export function listInstalled(unitOfWork: McpOperatorUnitOfWork, principalId: string): Promise<McpInstalled[]>
{
	return unitOfWork.execute(async function _List(transaction) { return (await transaction.mcp.listInstalls(principalId)).map(_MapInstall); });
}

/**
 * Installs a published MCP server after checking its current authorization again.
 *
 * A catalog result may be stale by the time a caller installs it. The flow therefore confirms that
 * the server is still in the caller's silo, still published, and still allowed by the MCP-use
 * capability before it writes the install. Multi-user servers start as `SharedKey`; other server
 * types start as `NeedsCredential`. The typed `Install` check, install, and audit entry all use the
 * same database transaction and commit or roll back together.
 *
 * Called by: {@link mcpOperatorRouter} for `POST /installed`.
 * @param unitOfWork - Runs the authorization check, installation write, and audit write together.
 * @param caller - Supplies the authenticated silo and local Principal to authorize.
 * @param serverId - Identifies the catalog server to install.
 * @returns The installed-server response, or `null` when the server is absent, unpublished, or not allowed.
 */
export function installServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpInstalled | null>
{
	return unitOfWork.execute(async function _Install(transaction)
	{
		const server = await transaction.mcp.findServer(caller.siloId, serverId);
		if (!server || !_GovernanceEligible(server))
			return null;
		const admission = await transaction.authorization.admitPrincipal({
			siloId: caller.siloId,
			principalId: caller.principalId,
			action: ProductAuthorizationActions.Install,
			resource: { kind: ProductAuthorizationResourceKinds.McpServer, id: serverId },
			nowEpochMs: Date.now(),
			actorKind: "user",
			actorId: caller.principalId,
			argumentsDigest: ___DigestCanonicalJson({} as JsonValue),
		});
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return null;
		const status = server.serverType === "MultiUser" ? "SharedKey" : "NeedsCredential";
		const installed = await transaction.mcp.upsertInstall(serverId, caller.principalId, status);
		await transaction.mcp.appendAudit(caller.siloId, "Created", `McpServerInstall/${serverId}:${caller.principalId}`, `MCP server ${serverId} installed for ${caller.principalId}`, caller.principalId);
		return _MapInstall(installed);
	});
}

/**
 * Removes one local Principal's installation of an MCP server.
 *
 * The delete includes both the server and Principal identifiers, so an uninstall request cannot
 * remove another principal's install. An audit entry is written only when a row was removed.
 *
 * Called by: {@link mcpOperatorRouter} for `DELETE /installed/:serverId`.
 * @param unitOfWork - Runs the deletion and any audit write together.
 * @param principalId - Identifies the local Principal whose installation may be removed.
 * @param serverId - Identifies the installed server to remove.
 * @returns `removed` after deleting an install, or `not_found` when this principal has none.
 */
export function uninstallServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<"removed" | "not_found">
{
	return unitOfWork.execute(async function _Delete(transaction)
	{
		const removed = await transaction.mcp.deleteInstall(serverId, caller.principalId);
		if (removed)
			await transaction.mcp.appendAudit(caller.siloId, "Deleted", `McpServerInstall/${serverId}:${caller.principalId}`, `MCP server ${serverId} uninstalled for ${caller.principalId}`, caller.principalId);
		return removed ? "removed" : "not_found";
	});
}

/**
 * Sets a server's approval status to `Approved` in the authenticated silo.
 *
 * The server must be waiting for review and must have accepted protocol evidence, unless it is an
 * existing catalogue row that predates protocol checks. The update and audit entry share one
 * database transaction.
 *
 * Called by: {@link mcpOperatorRouter} for `POST /servers/:id/approve`.
 * @param unitOfWork - Runs the status update and audit write together.
 * @param caller - Supplies the authenticated silo and acting Principal.
 * @param serverId - Identifies the server whose status to set.
 * @returns The updated server, or `null` when the server is outside the caller's silo or absent.
 */
export function approveServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Approved", "approved");
}

/**
 * Sets a server's approval status to `Published` in the authenticated silo.
 *
 * The server must already be approved and must have accepted protocol evidence, unless it is an
 * existing catalogue row that predates protocol checks. The update and audit entry share one
 * database transaction.
 *
 * Called by: {@link mcpOperatorRouter} for `POST /servers/:id/publish`.
 * @param unitOfWork - Runs the status update and audit write together.
 * @param caller - Supplies the authenticated silo and acting Principal.
 * @param serverId - Identifies the server whose status to set.
 * @returns The updated server, or `null` when the server is outside the caller's silo or absent.
 */
export function publishServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Published", "published");
}

/**
 * Sets a server's approval status to `Disabled` in the authenticated silo.
 *
 * This endpoint is a status setter: it does not require the server to be in a prior approval
 * status. A missing server in the silo returns `null`; an updated server is audited and returned.
 *
 * Called by: {@link mcpOperatorRouter} for `POST /servers/:id/reject`.
 * @param unitOfWork - Runs the status update and audit write together.
 * @param caller - Supplies the authenticated silo and acting Principal.
 * @param serverId - Identifies the server whose status to set.
 * @returns The updated server, or `null` when the server is outside the caller's silo or absent.
 */
export function rejectServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Disabled", "rejected");
}

/**
 * Sets a server's approval status from an administrator's enabled choice.
 *
 * `false` disables the current server. `true` restores a disabled server to `Published` after the
 * same saved protocol evidence check used by first publication.
 *
 * Called by: {@link mcpOperatorRouter} for `POST /servers/:id/enabled`.
 * @param unitOfWork - Runs the status update and audit write together.
 * @param caller - Supplies the authenticated silo and acting Principal.
 * @param serverId - Identifies the server whose status to set.
 * @param enabled - Selects `Published` when true and `Disabled` when false.
 * @returns The updated server, or `null` when the server is outside the caller's silo or absent.
 */
export function setServerEnabled(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, enabled: boolean): Promise<McpCatalogServer | null>
{
	if (enabled)
		return _Approval(unitOfWork, caller, serverId, "Published", "enabled", "Disabled");
	return _Approval(unitOfWork, caller, serverId, "Disabled", "disabled");
}

/**
 * Writes a requested approval status and appends the matching audit entry.
 *
 * The repository checks the required current approval and protocol states in the same update that
 * writes the new state. A caller may override the normal approval source for a named transition,
 * such as restoring a disabled server to `Published`.
 */
function _Approval(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, status: string, verb: string, sourceStatus?: string): Promise<McpCatalogServer | null>
{
	return unitOfWork.execute(async function _Update(transaction)
	{
		await __RequireMcpOrganizationAdministration(transaction.authorization, caller, { operation: "mcp-server-status", serverId, status, sourceStatus: sourceStatus ?? null });
		const requiredApprovalStatus = sourceStatus ?? (status === "Approved" || status === "Published" ? _REQUIRED_APPROVAL[status] : undefined);
		const server = await transaction.mcp.setApprovalStatus(caller.siloId, serverId, status, __McpEraProbeRequiredStates(status), requiredApprovalStatus);
		if (!server)
			return null;
		await transaction.mcp.appendAudit(caller.siloId, "Updated", `McpServer/${serverId}`, `MCP server ${serverId} ${verb}`, caller.principalId);
		return _MapServer(server);
	});
}

/** Maps the repository projection into the catalog contract and normalizes optional fields. */
function _MapServer(server: McpOperatorServerRecord): McpCatalogServer
{
	return { id: server.id, name: server.name, description: server.description, publisher: server.publisher ?? undefined, glyph: server.glyph ?? undefined, type: _TYPE[server.serverType as keyof typeof _TYPE], approvalStatus: _APPROVAL[server.approvalStatus as keyof typeof _APPROVAL], credentialSchema: _CredentialSchema(server.credentialSchema), entitlementSummary: server.entitlementSummary ?? undefined, tools: _MapTools(server) };
}

/**
 * Maps tools from the newest Ready server revision without treating visibility as authorization.
 *
 * A user reaches this mapper only after the catalogue checks saved grants. The administrator route
 * can reach it for any server in the silo, so each row separately reports whether Published and
 * Active governance currently permits assignment.
 */
function _MapTools(server: McpOperatorServerRecord): McpAssignableToolRevision[]
{
	const revision = server.latestReadyRevision;
	if (!revision || !_READY_REVISION_STATE[revision.state as keyof typeof _READY_REVISION_STATE])
		return [];
	const eligibility = _GovernanceEligible(server)
		? McpToolRevisionEligibility.Assignable
		: McpToolRevisionEligibility.GovernanceBlocked;
	return revision.tools.map(function _MapTool(tool): McpAssignableToolRevision
	{
		return {
			toolRevisionId: tool.id,
			serverRevisionId: revision.id,
			name: tool.name,
			description: tool.description,
			inputSchema: ___CloneCanonicalJson(tool.inputSchema as JsonValue),
			inputSchemaDigest: tool.inputSchemaDigest,
			eligibility,
			readiness: McpToolRevisionReadiness.Ready,
		};
	});
}

/** Checks the server states that must remain true before a tool revision may be assigned. */
function _GovernanceEligible(server: McpOperatorServerRecord): boolean
{
	const approvalStatus = _APPROVAL[server.approvalStatus as keyof typeof _APPROVAL];
	const revisionState = server.latestReadyRevision?.state;
	return approvalStatus === McpApprovalStatus.Published
		&& _ASSIGNABLE_SERVER_STATUS[server.status as keyof typeof _ASSIGNABLE_SERVER_STATUS] === true
		&& revisionState !== undefined
		&& _READY_REVISION_STATE[revisionState as keyof typeof _READY_REVISION_STATE] === true;
}

/** Maps one persisted installation into the response status and ISO timestamp expected by clients. */
function _MapInstall(install: McpOperatorInstallRecord): McpInstalled
{
	return { serverId: install.mcpServerId, connectionStatus: _CONNECTION[install.connectionStatus as keyof typeof _CONNECTION], lastUsed: install.lastUsedAt?.toISOString() ?? null };
}

/**
 * Converts a stored schema value into contract fields and drops malformed entries.
 *
 * The repository exposes this value as `unknown`, so the mapper must verify each field before a
 * catalog response can claim that the field has a key and label.
 */
function _CredentialSchema(value: unknown): CredentialField[]
{
	if (!Array.isArray(value))
		return [];
	return value.flatMap(function _Field(entry): CredentialField[]
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry))
			return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.key !== "string" || typeof record.label !== "string")
			return [];
			return [{
				key: record.key,
				label: record.label,
				required: record.required === true,
				sensitive: record.sensitive === true,
				...(typeof record.placeholder === "string" ? { placeholder: record.placeholder } : {}),
				...(typeof record.hint === "string" ? { hint: record.hint } : {}),
			}];
	});
}
