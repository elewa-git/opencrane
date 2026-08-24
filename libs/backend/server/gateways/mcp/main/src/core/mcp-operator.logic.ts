import { McpApprovalStatus, McpConnectionStatus, McpServerType, type CredentialField, type Directory, type EntitledUser, type McpAccessPolicy, type McpCatalogServer, type McpInstalled } from "@opencrane/contracts";
import { __ResolvePrincipalAuthorization } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, type AuthorizationBoundary, type CapabilityReference } from "@opencrane/models/authorization";
import { ___SortBy } from "@opencrane/util";
import type { McpAccessPolicyCommand, McpOperatorCaller } from "./mcp-operator.logic.types";
import type { McpOperatorInstallRecord, McpOperatorPrincipalRecord, McpOperatorServerRecord, McpOperatorTransaction, McpOperatorUnitOfWork } from "./mcp-operator-repository.types";
import { __McpEraProbeRequiredState } from "../era-probe/mcp-era-probe-state";

const _CATALOG_ID = "opencrane-core";
const _CATALOG_REVISION = 1;
const _USE_CAPABILITY_ID = "mcp-server:use";
const _ACCESS_MANAGER_ID = "mcp-access-editor";
const _RESOURCE_KIND = "mcp-server";

const _TYPE = { SingleUser: McpServerType.SingleUser, MultiUser: McpServerType.MultiUser, RemoteOauth: McpServerType.RemoteOauth } as const;
const _APPROVAL = { PendingReview: McpApprovalStatus.PendingReview, Approved: McpApprovalStatus.Approved, Published: McpApprovalStatus.Published, Disabled: McpApprovalStatus.Disabled } as const;
const _REQUIRED_APPROVAL = { Approved: "PendingReview", Published: "Approved" } as const;
const _CONNECTION = { NeedsCredential: McpConnectionStatus.NeedsCredential, SharedKey: McpConnectionStatus.SharedKey } as const;
const _AVATAR_COLORS = ["#1F3B6E", "#2E7D32", "#6A1B9A", "#C62828", "#00838F", "#EF6C00", "#4527A0", "#283593"];

/**
 * Lists published MCP catalog entries that the caller's persisted authorization grants allow.
 *
 * A published row is not enough to appear in the catalog: this flow resolves the local Principal
 * and its persisted group subjects for the MCP-use capability. It returns no rows when that
 * capability is absent, so a missing catalog entry cannot grant catalog access.
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
		const [servers, capability] = await Promise.all([transaction.mcp.listPublishedServers(caller.siloId), _Capability(transaction)]);
		if (!capability) return [];
		const decisions = await Promise.all(servers.map(async function _Decide(server)
		{
			return await _Allowed(transaction, caller, capability, server.id) ? _MapServer(server) : null;
		}));
		return decisions.filter(function _Present(server): server is McpCatalogServer { return server !== null; });
	});
}

/**
 * Lists every MCP catalog row in the authenticated administrator's silo for governance.
 *
 * Unlike {@link listEntitledCatalog}, this view includes unpublished rows because its route is
 * already gated for organization administrators; the silo still prevents it from reading another
 * organization's catalog.
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
 * types start as `NeedsCredential`. The install and its audit entry commit or roll back together.
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
		const [server, capability] = await Promise.all([transaction.mcp.findServer(caller.siloId, serverId), _Capability(transaction)]);
		if (!server || server.approvalStatus !== "Published" || !capability || !(await _Allowed(transaction, caller, capability, serverId))) return null;
		const status = server.serverType === "MultiUser" ? "SharedKey" : "NeedsCredential";
		const installed = await transaction.mcp.upsertInstall(serverId, caller.principalId, status);
		await transaction.mcp.appendAudit("Created", `McpServerInstall/${serverId}:${caller.principalId}`, `MCP server ${serverId} installed for ${caller.principalId}`);
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
export function uninstallServer(unitOfWork: McpOperatorUnitOfWork, principalId: string, serverId: string): Promise<"removed" | "not_found">
{
	return unitOfWork.execute(async function _Delete(transaction)
	{
		const removed = await transaction.mcp.deleteInstall(serverId, principalId);
		if (removed) await transaction.mcp.appendAudit("Deleted", `McpServerInstall/${serverId}:${principalId}`, `MCP server ${serverId} uninstalled for ${principalId}`);
		return removed ? "removed" : "not_found";
	});
}

/**
 * Sets a server's approval status to `Approved` in the authenticated silo.
 *
 * This endpoint is a status setter: it does not require the server to be in a prior approval
 * status. A missing server in the silo returns `null`; an updated server is audited and returned.
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
 * This endpoint is a status setter: it does not require the server to be in a prior approval
 * status. A missing server in the silo returns `null`; an updated server is audited and returned.
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
 * `true` writes `Published` and `false` writes `Disabled`. Like the other approval endpoints,
 * this is a status setter and does not require the server to be in a prior status.
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
	if (enabled) return _Approval(unitOfWork, caller, serverId, "Published", "enabled");
	return _Approval(unitOfWork, caller, serverId, "Disabled", "disabled");
}

/**
 * Reads the access policy represented by grants managed by the MCP access editor.
 *
 * The flow first confirms that the server belongs to the caller's silo, then maps the managed
 * group and Principal subjects back to local directory records. It does not use identity-provider
 * claims as policy subjects.
 *
 * Called by: {@link mcpOperatorRouter} for `GET /servers/:id/access`.
 * @param unitOfWork - Runs the silo check, grant read, and local directory reads together.
 * @param caller - Supplies the authenticated silo.
 * @param serverId - Identifies the server whose managed grants to read.
 * @returns The access policy, or `null` when the server is outside the caller's silo or absent.
 */
export function getAccessPolicy(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpAccessPolicy | null>
{
	return unitOfWork.execute(async function _Read(transaction)
	{
		if (!(await transaction.mcp.findServer(caller.siloId, serverId))) return null;
		const grants = await transaction.managedGrants.listManagedResourceGrants(caller.siloId, _ACCESS_MANAGER_ID, { kind: _RESOURCE_KIND, id: serverId });
		const groupIds = grants.flatMap(grant => grant.subject.kind === AuthorizationSubjectKinds.Group ? [grant.subject.groupId] : []);
		const principalIds = grants.flatMap(grant => grant.subject.kind === AuthorizationSubjectKinds.Principal ? [grant.subject.principalId] : []);
		const [groups, principals] = await Promise.all([transaction.mcp.listGroups(caller.siloId, groupIds), transaction.mcp.listPrincipals(caller.siloId, principalIds)]);
		return { serverId, groups: [...groups], users: principals.map(_MapPrincipal) };
	});
}

/**
 * Reconciles the MCP access editor's grants for one server and records the governance change.
 *
 * The proposed group and Principal identifiers must all resolve inside the caller's silo before the
 * grants are replaced. This prevents an access policy from naming a record outside that silo. The
 * reconciliation and audit entry run in the same transaction, so neither persists without the other.
 *
 * Called by: {@link mcpOperatorRouter} for `PUT /servers/:id/access`.
 * @param unitOfWork - Runs the validation reads, grant reconciliation, and audit write together.
 * @param caller - Supplies the authenticated silo and acting Principal.
 * @param serverId - Identifies the server whose managed grants to replace.
 * @param body - Supplies the proposed local group and Principal identifiers.
 * @returns The reconciled policy, or `null` when the server, a proposed subject, or the capability is absent.
 */
export function setAccessPolicy(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, body: McpAccessPolicyCommand): Promise<McpAccessPolicy | null>
{
	return unitOfWork.execute(async function _Write(transaction)
	{
		if (!(await transaction.mcp.findServer(caller.siloId, serverId))) return null;
		const groupIds = _Ids(body.groupIds);
		const principalIds = _Ids(body.principalIds);
		const [groups, principals, capability] = await Promise.all([transaction.mcp.listGroups(caller.siloId, groupIds), transaction.mcp.listPrincipals(caller.siloId, principalIds), _Capability(transaction)]);
		if (groups.length !== groupIds.length || principals.length !== principalIds.length || !capability) return null;
		const resource = { kind: _RESOURCE_KIND, id: serverId } as const;
		await transaction.managedGrants.reconcileManagedResourceGrants({
			siloId: caller.siloId,
			managerId: _ACCESS_MANAGER_ID,
			resource,
			grants: [
				...groups.map(group => ({ subject: { kind: AuthorizationSubjectKinds.Group, groupId: group.id }, boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: group.id }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: caller.principalId }) as const),
				...principals.map(principal => ({ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: principal.id }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: principal.id }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: caller.principalId }) as const),
			],
			now: new Date(),
		});
		await transaction.mcp.appendAudit("Updated", `McpServer/${serverId}`, `MCP server ${serverId} authorization grants updated`);
		return { serverId, groups: [...groups], users: principals.map(_MapPrincipal) };
	});
}

/**
 * Lists local Principals and persisted groups that an administrator may select for MCP access.
 *
 * The directory comes from the authenticated silo's records. This keeps access policy subjects
 * stable and avoids treating identity-provider group claims as stored authorization subjects.
 *
 * Called by: {@link mcpOperatorRouter} for `GET /directory`.
 * @param unitOfWork - Runs the directory reads in the authenticated silo.
 * @param caller - Supplies the authenticated silo.
 * @returns The local group and Principal choices for the MCP access editor.
 */
export function getDirectory(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller): Promise<Directory>
{
	return unitOfWork.execute(async function _Directory(transaction)
	{
		const [groups, principals] = await Promise.all([transaction.mcp.listGroups(caller.siloId), transaction.mcp.listPrincipals(caller.siloId)]);
		return { groups: [...groups], users: principals.map(_MapPrincipal) };
	});
}

/**
 * Finds the MCP-use capability from the configured catalog revision.
 *
 * Catalog and install flows deny access when this lookup fails because they cannot evaluate a
 * grant without the capability it grants.
 */
async function _Capability(transaction: McpOperatorTransaction): Promise<CapabilityReference | null>
{
	return transaction.capabilityCatalog.findCapability(_CATALOG_ID, _CATALOG_REVISION, _USE_CAPABILITY_ID);
}

/**
 * Checks the caller's personal and persisted-group boundaries for MCP-use access to a server.
 *
 * The authorization repository supplies the local group subjects. That keeps authorization based
 * on stored Principal and group records instead of claims carried by the request.
 */
async function _Allowed(transaction: McpOperatorTransaction, caller: McpOperatorCaller, capability: CapabilityReference, serverId: string): Promise<boolean>
{
	const subjects = await transaction.authorization.resolvePrincipalSubjects(caller.siloId, caller.principalId);
	const boundaries: AuthorizationBoundary[] = [{ kind: AuthorizationBoundaryKinds.Personal, principalId: caller.principalId }];
	for (const subject of subjects)
	{
		if (subject.kind === AuthorizationSubjectKinds.Group) boundaries.push({ kind: AuthorizationBoundaryKinds.Group, groupId: subject.groupId });
	}
	for (const boundary of boundaries)
	{
		const decision = await __ResolvePrincipalAuthorization(transaction.authorization, { siloId: caller.siloId, principalId: caller.principalId, boundary, capability, resource: { kind: _RESOURCE_KIND, id: serverId }, nowEpochMs: Date.now() });
		if (decision.outcome === AuthorizationDecisionOutcomes.Allow) return true;
	}
	return false;
}

/**
 * Writes a requested approval status and appends the matching audit entry.
 *
 * It delegates to the silo-scoped repository setter and intentionally does not inspect the server's
 * current status; the route endpoints therefore set a status rather than enforce a transition.
 */
function _Approval(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, status: string, verb: string): Promise<McpCatalogServer | null>
{
	return unitOfWork.execute(async function _Update(transaction)
	{
		const requiredApprovalStatus = status === "Approved" || status === "Published" ? _REQUIRED_APPROVAL[status] : undefined;
		const server = await transaction.mcp.setApprovalStatus(caller.siloId, serverId, status, __McpEraProbeRequiredState(status), requiredApprovalStatus);
		if (!server) return null;
		await transaction.mcp.appendAudit("Updated", `McpServer/${serverId}`, `MCP server ${serverId} ${verb}`);
		return _MapServer(server);
	});
}

/** Maps the repository projection into the catalog contract and normalizes optional fields. */
function _MapServer(server: McpOperatorServerRecord): McpCatalogServer
{
	return { id: server.id, name: server.name, description: server.description, publisher: server.publisher ?? undefined, glyph: server.glyph ?? undefined, type: _TYPE[server.serverType as keyof typeof _TYPE], approvalStatus: _APPROVAL[server.approvalStatus as keyof typeof _APPROVAL], credentialSchema: _CredentialSchema(server.credentialSchema), entitlementSummary: server.entitlementSummary ?? undefined };
}

/** Maps one persisted installation into the response status and ISO timestamp expected by clients. */
function _MapInstall(install: McpOperatorInstallRecord): McpInstalled
{
	return { serverId: install.mcpServerId, connectionStatus: _CONNECTION[install.connectionStatus as keyof typeof _CONNECTION], lastUsed: install.lastUsedAt?.toISOString() ?? null };
}

/**
 * Maps a local Principal into the directory shape used by the access editor.
 *
 * It prefers a stored display name, then a stored email's local part, and finally the Principal ID
 * so every persisted subject remains selectable even when profile fields are absent.
 */
function _MapPrincipal(principal: McpOperatorPrincipalRecord): EntitledUser
{
	const name = principal.displayName?.trim() || principal.email?.split("@")[0] || principal.id;
	const words = name.split(/[\s._-]+/).filter(word => word.length > 0);
	const initials = (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)).toUpperCase();
	let checksum = 0;
	for (let index = 0; index < principal.id.length; index += 1) checksum = (checksum + principal.id.charCodeAt(index)) % _AVATAR_COLORS.length;
	return { id: principal.id, name, initials, color: _AVATAR_COLORS[checksum] };
}

/**
 * Converts a stored schema value into contract fields and drops malformed entries.
 *
 * The repository exposes this value as `unknown`, so the mapper must verify each field before a
 * catalog response can claim that the field has a key and label.
 */
function _CredentialSchema(value: unknown): CredentialField[]
{
	if (!Array.isArray(value)) return [];
	return value.flatMap(function _Field(entry): CredentialField[]
	{
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.key !== "string" || typeof record.label !== "string") return [];
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

/**
 * Trims, de-duplicates, and sorts proposed access-policy identifiers.
 *
 * Reconciliation compares the resulting identifiers with records found in the caller's silo, so
 * repeated or blank request values cannot create duplicate grant subjects.
 */
function _Ids(values: readonly string[] | undefined): string[]
{
	if (!values) return [];
	return ___SortBy([...new Set(values.map(value => value.trim()).filter(value => value.length > 0))]);
}
