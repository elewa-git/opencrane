import { GrantScope, McpServerStatus, McpServerTransport, type McpServer, type McpServerCredential } from "@opencrane/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpServerCredentialInput, McpServerWriteRequest } from "../routes/mcp-servers.types.js";
import type { McpServerCredentialWrite, McpServerMutationRepository } from "./mcp-server-mutation-repository.types.js";

type _McpServerRow = Prisma.McpServerGetPayload<{ include: { credentials: true; source: true } }>;

/** Shared response contract returned by the MCP server routes. */
type McpServerResponse = McpServer;

/** Shared credential contract returned for normalized credential rows. */
type McpServerCredentialResponse = McpServerCredential;

/** Persist response shape returned after create/update/delete mutations. */
interface McpServerMutationResponse
{
	/** Stable server identifier. */
	id: string;
	/** Mutation outcome label. */
	status: "created" | "updated" | "deleted";
}

/** Typed Prisma scope values used during runtime lookups. */
const _PRISMA_GRANT_SCOPE = {
	Org: "Org",
	Department: "Department",
	Team: "Team",
	Project: "Project",
	Personal: "Personal",
} as const;

/** Typed Prisma transport values used during runtime lookups. */
const _PRISMA_MCP_SERVER_TRANSPORT = {
	StreamableHttp: "StreamableHttp",
	ServerSentEvents: "ServerSentEvents",
	WebSocket: "WebSocket",
} as const;

/** Typed Prisma status values used during runtime lookups. */
const _PRISMA_MCP_SERVER_STATUS = {
	Active: "Active",
	Degraded: "Degraded",
	Draft: "Draft",
} as const;

/** Route scope lookup keyed by Prisma enum values. */
const _ROUTE_SCOPE_BY_PRISMA_SCOPE = {
	[_PRISMA_GRANT_SCOPE.Org]: GrantScope.Org,
	[_PRISMA_GRANT_SCOPE.Department]: GrantScope.Department,
	[_PRISMA_GRANT_SCOPE.Team]: GrantScope.Team,
	[_PRISMA_GRANT_SCOPE.Project]: GrantScope.Project,
	[_PRISMA_GRANT_SCOPE.Personal]: GrantScope.Personal,
};

/** Prisma scope lookup keyed by route values. */
const _PRISMA_SCOPE_BY_ROUTE_SCOPE = {
	org: _PRISMA_GRANT_SCOPE.Org,
	department: _PRISMA_GRANT_SCOPE.Department,
	project: _PRISMA_GRANT_SCOPE.Project,
	personal: _PRISMA_GRANT_SCOPE.Personal,
};

/** Route transport lookup keyed by Prisma enum values. */
const _ROUTE_TRANSPORT_BY_PRISMA_TRANSPORT = {
	[_PRISMA_MCP_SERVER_TRANSPORT.StreamableHttp]: McpServerTransport.StreamableHttp,
	[_PRISMA_MCP_SERVER_TRANSPORT.ServerSentEvents]: McpServerTransport.ServerSentEvents,
	[_PRISMA_MCP_SERVER_TRANSPORT.WebSocket]: McpServerTransport.WebSocket,
};

/** Prisma transport lookup keyed by route values. */
const _PRISMA_TRANSPORT_BY_ROUTE_TRANSPORT = {
	"streamable-http": _PRISMA_MCP_SERVER_TRANSPORT.StreamableHttp,
	sse: _PRISMA_MCP_SERVER_TRANSPORT.ServerSentEvents,
	websocket: _PRISMA_MCP_SERVER_TRANSPORT.WebSocket,
};

/** Route status lookup keyed by Prisma enum values. */
const _ROUTE_STATUS_BY_PRISMA_STATUS = {
	[_PRISMA_MCP_SERVER_STATUS.Active]: McpServerStatus.Active,
	[_PRISMA_MCP_SERVER_STATUS.Degraded]: McpServerStatus.Degraded,
	[_PRISMA_MCP_SERVER_STATUS.Draft]: McpServerStatus.Draft,
};

/** Prisma status lookup keyed by route values. */
const _PRISMA_STATUS_BY_ROUTE_STATUS = {
	active: _PRISMA_MCP_SERVER_STATUS.Active,
	degraded: _PRISMA_MCP_SERVER_STATUS.Degraded,
	draft: _PRISMA_MCP_SERVER_STATUS.Draft,
};

/**
 * Load every persisted MCP server with credentials and source metadata.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Normalized route response rows.
 */
export async function listMcpServers(prisma: PrismaClient): Promise<McpServerResponse[]>
{
	const servers = await prisma.mcpServer.findMany({
		orderBy: { createdAt: "desc" },
		include: { credentials: true, source: true },
	});

	return servers.map(function _mapServer(server)
	{
		return _MapMcpServerResponse(server);
	});
}

/**
 * Load a single persisted MCP server with credentials and source metadata.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Server identifier from the route.
 * @returns Normalized response or null when the server does not exist.
 */
export async function getMcpServer(prisma: PrismaClient, serverId: string): Promise<McpServerResponse | null>
{
	const server = await prisma.mcpServer.findUnique({
		where: { id: serverId },
		include: { credentials: true, source: true },
	});

	return server ? _MapMcpServerResponse(server) : null;
}

/**
 * Create an MCP server and its child credential rows.
 *
 * @param prisma - Prisma client used for persistence.
 * @param mutationRepository - MCP aggregate persistence seam.
 * @param body - Route payload provided by the caller.
 * @returns Mutation response consumed by the route.
 */
export async function createMcpServer(mutationRepository: McpServerMutationRepository, body: McpServerWriteRequest): Promise<McpServerMutationResponse>
{
	const createdServer = await mutationRepository.createServer({
		name: body.name,
		description: body.description ?? "",
		endpoint: body.endpoint,
		scope: _PRISMA_SCOPE_BY_ROUTE_SCOPE[body.scope],
		transport: _PRISMA_TRANSPORT_BY_ROUTE_TRANSPORT[body.transport],
		status: _PRISMA_STATUS_BY_ROUTE_STATUS[body.status ?? "draft"],
		capabilities: _NormalizeStringArray(body.capabilities),
		...(body.sourceId ? { sourceId: body.sourceId } : {}),
		...(body.lastSyncedAt ? { lastSyncedAt: new Date(body.lastSyncedAt) } : {}),
		credentials: _NormalizeCredentialWrites(body.credentials),
	});

	return { id: createdServer.id, status: "created" };
}

/**
 * Update an MCP server and fully replace its child credential rows.
 *
 * @param mutationRepository - MCP aggregate persistence seam.
 * @param serverId - Server identifier from the route.
 * @param body - Partial route payload provided by the caller.
 * @returns Mutation response consumed by the route.
 */
export async function updateMcpServer(mutationRepository: McpServerMutationRepository, serverId: string, body: Partial<McpServerWriteRequest>): Promise<McpServerMutationResponse>
{
	await mutationRepository.updateServer({
		id: serverId,
		...(body.name ? { name: body.name } : {}),
		...(body.description !== undefined ? { description: body.description ?? "" } : {}),
		...(body.endpoint ? { endpoint: body.endpoint } : {}),
		...(body.scope ? { scope: _PRISMA_SCOPE_BY_ROUTE_SCOPE[body.scope] } : {}),
		...(body.transport ? { transport: _PRISMA_TRANSPORT_BY_ROUTE_TRANSPORT[body.transport] } : {}),
		...(body.status ? { status: _PRISMA_STATUS_BY_ROUTE_STATUS[body.status] } : {}),
		...(body.capabilities ? { capabilities: _NormalizeStringArray(body.capabilities) } : {}),
		...(body.sourceId !== undefined ? { sourceId: body.sourceId } : {}),
		...(body.lastSyncedAt !== undefined ? { lastSyncedAt: body.lastSyncedAt ? new Date(body.lastSyncedAt) : null } : {}),
		credentials: _NormalizeCredentialWrites(body.credentials),
	});

	return { id: serverId, status: "updated" };
}

/**
 * Delete an MCP server and its child credential rows.
 *
 * @param mutationRepository - MCP aggregate persistence seam.
 * @param serverId - Server identifier from the route.
 * @returns Mutation response consumed by the route.
 */
export async function deleteMcpServer(mutationRepository: McpServerMutationRepository, serverId: string): Promise<McpServerMutationResponse>
{
	await mutationRepository.deleteServer(serverId);

	return { id: serverId, status: "deleted" };
}

/**
 * List the brokered credentials of a single MCP server.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Server identifier from the route.
 * @returns Credential responses, or null when the server does not exist.
 */
export async function listMcpServerCredentials(prisma: PrismaClient, serverId: string): Promise<McpServerCredentialResponse[] | null>
{
	const server = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { id: true } });
	if (!server)
	{
		return null;
	}

	const credentials = await prisma.mcpServerCredential.findMany({ where: { mcpServerId: serverId }, orderBy: { createdAt: "asc" } });
	return credentials.map(function _mapCredential(credential)
	{
		return _MapCredentialResponse(credential);
	});
}

/**
 * Add a single brokered credential to an MCP server.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Server identifier from the route.
 * @param input - OBO credential metadata to persist.
 * @returns The created credential response, or null when the server is absent.
 */
export async function addMcpServerCredential(prisma: PrismaClient, serverId: string, input: McpServerCredentialInput): Promise<McpServerCredentialResponse | null>
{
	const server = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { id: true } });
	if (!server)
	{
		return null;
	}

	const row = _NormalizeCredentialInput(serverId, input);
	const created = await prisma.mcpServerCredential.create({ data: row });

	await prisma.auditEntry.create({
		data: {
			action: "Created",
			resource: `McpServerCredential/${created.id}`,
			message: `OBO MCP credential ${created.displayName} added to server ${serverId}`,
		},
	});

	return _MapCredentialResponse(created);
}

/**
 * Remove a single brokered credential from an MCP server.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Server identifier from the route.
 * @param credentialId - Credential identifier from the route.
 * @returns Mutation response, or null when the credential is not on the server.
 */
export async function deleteMcpServerCredential(prisma: PrismaClient, serverId: string, credentialId: string): Promise<McpServerMutationResponse | null>
{
	const credential = await prisma.mcpServerCredential.findFirst({ where: { id: credentialId, mcpServerId: serverId }, select: { id: true } });
	if (!credential)
	{
		return null;
	}

	await prisma.mcpServerCredential.delete({ where: { id: credentialId } });

	await prisma.auditEntry.create({
		data: {
			action: "Deleted",
			resource: `McpServerCredential/${credentialId}`,
			message: `MCP credential ${credentialId} removed from server ${serverId}`,
		},
	});

	return { id: credentialId, status: "deleted" };
}

/**
 * Normalize an OBO-only credential write payload for persistence.
 *
 * @param serverId - Owning MCP server identifier.
 * @param credential - Raw credential payload from the route body.
 * @returns Prisma createMany input for the credential row.
 */
export function _NormalizeCredentialInput(serverId: string, credential: McpServerCredentialInput): Prisma.McpServerCredentialCreateManyInput
{
	return {
		mcpServerId: serverId,
		displayName: credential.displayName,
	};
}

/** Validates and normalizes credential labels before any aggregate persistence begins. */
function _NormalizeCredentialWrites(credentials: readonly McpServerCredentialInput[] | undefined): readonly McpServerCredentialWrite[]
{
	return credentials?.map(function _normalizeCredential(credential)
	{
		if (typeof credential.displayName !== "string" || credential.displayName.trim().length === 0)
		{
			throw new Error("MCP credential displayName must be a non-empty string");
		}
		return { displayName: credential.displayName.trim() };
	}) ?? [];
}

/**
 * Map a raw server row into the route response shape.
 *
 * @param server - Persisted server with child rows loaded.
 * @returns Normalized response payload.
 */
function _MapMcpServerResponse(server: _McpServerRow): McpServerResponse
{
	return {
		id: server.id,
		name: server.name,
		description: server.description,
		endpoint: server.endpoint,
		scope: _ROUTE_SCOPE_BY_PRISMA_SCOPE[server.scope],
		transport: _ROUTE_TRANSPORT_BY_PRISMA_TRANSPORT[server.transport],
		status: _ROUTE_STATUS_BY_PRISMA_STATUS[server.status],
		capabilities: server.capabilities,
		sourceName: server.source?.name ?? undefined,
		lastSyncedAt: server.lastSyncedAt?.toISOString(),
		grants: [],
		credentials: server.credentials.map(function _mapCredential(credential)
		{
			return _MapCredentialResponse(credential);
		}),
	};
}

/**
 * Map a persisted credential row into the route response shape.
 *
 * @param credential - Persisted credential row.
 * @returns Normalized credential response payload.
 */
function _MapCredentialResponse(credential: _McpServerRow["credentials"][number]): McpServerCredentialResponse
{
	return {
		id: credential.id,
		displayName: credential.displayName,
	};
}

/**
 * Normalize capability labels into a unique trimmed string array.
 *
 * @param values - Raw request values.
 * @returns Canonical capability labels.
 */
function _NormalizeStringArray(values: string[] | undefined): string[]
{
	if (!values)
	{
		return [];
	}

	const uniqueValues = new Set<string>();
	for (const value of values)
	{
		const normalizedValue = value.trim();
		if (normalizedValue.length === 0)
		{
			continue;
		}

		uniqueValues.add(normalizedValue);
	}

	return Array.from(uniqueValues);
}
