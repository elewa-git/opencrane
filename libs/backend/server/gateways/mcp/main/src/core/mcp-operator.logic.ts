import { McpApprovalStatus, McpConnectionStatus, McpServerType, type CredentialField, type Directory, type EntitledUser, type McpAccessPolicy, type McpCatalogServer, type McpInstalled } from "@opencrane/contracts";
import { __ResolvePrincipalAuthorization } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, type AuthorizationBoundary, type CapabilityReference } from "@opencrane/models/authorization";
import { ___SortBy } from "@opencrane/util";
import type { McpAccessPolicyCommand, McpOperatorCaller } from "./mcp-operator.logic.types";
import type { McpOperatorInstallRecord, McpOperatorPrincipalRecord, McpOperatorServerRecord, McpOperatorTransaction, McpOperatorUnitOfWork } from "./mcp-operator-repository.types";

const _CATALOG_ID = "opencrane-core";
const _CATALOG_REVISION = 1;
const _USE_CAPABILITY_ID = "mcp-server:use";
const _ACCESS_MANAGER_ID = "mcp-access-editor";
const _RESOURCE_KIND = "mcp-server";

const _TYPE = { SingleUser: McpServerType.SingleUser, MultiUser: McpServerType.MultiUser, RemoteOauth: McpServerType.RemoteOauth } as const;
const _APPROVAL = { PendingReview: McpApprovalStatus.PendingReview, Approved: McpApprovalStatus.Approved, Published: McpApprovalStatus.Published, Disabled: McpApprovalStatus.Disabled } as const;
const _CONNECTION = { NeedsCredential: McpConnectionStatus.NeedsCredential, SharedKey: McpConnectionStatus.SharedKey } as const;
const _AVATAR_COLORS = ["#1F3B6E", "#2E7D32", "#6A1B9A", "#C62828", "#00838F", "#EF6C00", "#4527A0", "#283593"];

/** Lists published MCP servers authorized by generic principal/group grants. */
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

/** Lists all catalog rows in the authenticated silo for governance. */
export function listAllServers(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller): Promise<McpCatalogServer[]>
{
	return unitOfWork.execute(async function _List(transaction)
	{
		return (await transaction.mcp.listAllServers(caller.siloId)).map(_MapServer);
	});
}

/** Lists one principal's installed MCP servers. */
export function listInstalled(unitOfWork: McpOperatorUnitOfWork, principalId: string): Promise<McpInstalled[]>
{
	return unitOfWork.execute(async function _List(transaction) { return (await transaction.mcp.listInstalls(principalId)).map(_MapInstall); });
}

/** Re-checks authorization and creates one install with its audit entry atomically. */
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

/** Removes one principal's install. */
export function uninstallServer(unitOfWork: McpOperatorUnitOfWork, principalId: string, serverId: string): Promise<"removed" | "not_found">
{
	return unitOfWork.execute(async function _Delete(transaction)
	{
		const removed = await transaction.mcp.deleteInstall(serverId, principalId);
		if (removed) await transaction.mcp.appendAudit("Deleted", `McpServerInstall/${serverId}:${principalId}`, `MCP server ${serverId} uninstalled for ${principalId}`);
		return removed ? "removed" : "not_found";
	});
}

/** Approves a server in the authenticated silo. */
export function approveServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Approved", "approved");
}

/** Publishes a server in the authenticated silo. */
export function publishServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Published", "published");
}

/** Disables a rejected server in the authenticated silo. */
export function rejectServer(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string): Promise<McpCatalogServer | null>
{
	return _Approval(unitOfWork, caller, serverId, "Disabled", "rejected");
}

/** Publishes or disables a server in the authenticated silo. */
export function setServerEnabled(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, enabled: boolean): Promise<McpCatalogServer | null>
{
	if (enabled) return _Approval(unitOfWork, caller, serverId, "Published", "enabled");
	return _Approval(unitOfWork, caller, serverId, "Disabled", "disabled");
}

/** Projects only grants owned by the MCP access editor. */
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

/** Atomically reconciles editor-owned grants and the governance audit entry. */
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

/** Lists stable local principals and groups in the authenticated silo. */
export function getDirectory(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller): Promise<Directory>
{
	return unitOfWork.execute(async function _Directory(transaction)
	{
		const [groups, principals] = await Promise.all([transaction.mcp.listGroups(caller.siloId), transaction.mcp.listPrincipals(caller.siloId)]);
		return { groups: [...groups], users: principals.map(_MapPrincipal) };
	});
}

async function _Capability(transaction: McpOperatorTransaction): Promise<CapabilityReference | null>
{
	return transaction.capabilityCatalog.findCapability(_CATALOG_ID, _CATALOG_REVISION, _USE_CAPABILITY_ID);
}

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

function _Approval(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, serverId: string, status: string, verb: string): Promise<McpCatalogServer | null>
{
	return unitOfWork.execute(async function _Update(transaction)
	{
		const server = await transaction.mcp.setApprovalStatus(caller.siloId, serverId, status);
		if (!server) return null;
		await transaction.mcp.appendAudit("Updated", `McpServer/${serverId}`, `MCP server ${serverId} ${verb}`);
		return _MapServer(server);
	});
}

function _MapServer(server: McpOperatorServerRecord): McpCatalogServer
{
	return { id: server.id, name: server.name, description: server.description, publisher: server.publisher ?? undefined, glyph: server.glyph ?? undefined, type: _TYPE[server.serverType as keyof typeof _TYPE], approvalStatus: _APPROVAL[server.approvalStatus as keyof typeof _APPROVAL], credentialSchema: _CredentialSchema(server.credentialSchema), entitlementSummary: server.entitlementSummary ?? undefined };
}

function _MapInstall(install: McpOperatorInstallRecord): McpInstalled
{
	return { serverId: install.mcpServerId, connectionStatus: _CONNECTION[install.connectionStatus as keyof typeof _CONNECTION], lastUsed: install.lastUsedAt?.toISOString() ?? null };
}

function _MapPrincipal(principal: McpOperatorPrincipalRecord): EntitledUser
{
	const name = principal.displayName?.trim() || principal.email?.split("@")[0] || principal.id;
	const words = name.split(/[\s._-]+/).filter(word => word.length > 0);
	const initials = (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)).toUpperCase();
	let checksum = 0;
	for (let index = 0; index < principal.id.length; index += 1) checksum = (checksum + principal.id.charCodeAt(index)) % _AVATAR_COLORS.length;
	return { id: principal.id, name, initials, color: _AVATAR_COLORS[checksum] };
}

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

function _Ids(values: readonly string[] | undefined): string[]
{
	if (!values) return [];
	return ___SortBy([...new Set(values.map(value => value.trim()).filter(value => value.length > 0))]);
}
