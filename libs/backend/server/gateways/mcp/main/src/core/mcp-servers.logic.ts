import { GrantScope, McpServerStatus, McpServerTransport, type McpServer, type McpServerCredential } from "@opencrane/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpServerCredentialInput, McpServerWriteRequest } from "../routes/mcp-servers.types.js";
import type { McpServerCredentialWrite, McpServerMutationRepository } from "./mcp-server-mutation-repository.types.js";

type _McpServerRow = Prisma.McpServerGetPayload<{ include: { credentials: true; source: true } }>;

/** Shared response contract returned by the MCP server routes. */
type McpServerResponse = McpServer;

/** Shared credential contract returned for normalized credential rows. */
type McpServerCredentialResponse = McpServerCredential;

/** What the create/update/delete routes answer with: the affected server id plus which of the three happened. */
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
 * Create one MCP server plus its credential label rows, through the supplied write port.
 *
 * Takes a repository rather than a Prisma client so the route can hand in a unit of work that
 * commits the server row, its credential rows, and the audit row together. Credential entries are
 * label-only: `_NormalizeCredentialWrites` trims each `displayName` and rejects a blank one, and
 * no secret value is accepted anywhere on this path.
 *
 * Called by: the `POST /` handler in `mcpServersRouter` (../routes/mcp-servers.ts), which is gated
 * by `_RequireOrgAdmin`.
 *
 * @param mutationRepository - Write port; the route passes `PrismaMcpServerMutationUnitOfWork`.
 * @param body - Route payload. The lowercase wire values for scope/transport/status are converted
 *               to Prisma enum member names here, and `status` defaults to `draft` when omitted.
 * @returns `{ id, status: "created" }` — the id the route puts in its 201 response.
 * @throws Error when a supplied credential has a missing or blank `displayName`.
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
 * Change an MCP server, and replace its credential rows with whatever the body carries.
 *
 * Any field the body omits is left as-is in the database. Credentials are the exception: they are
 * always replaced, so a body with no `credentials` key deletes every credential row the server had.
 * `sourceId` and `lastSyncedAt` accept an explicit null to clear the stored value.
 *
 * Called by: the `PUT /:id` handler in `mcpServersRouter` (../routes/mcp-servers.ts), gated by
 * `_RequireOrgAdmin`.
 *
 * @param mutationRepository - Write port; the route passes `PrismaMcpServerMutationUnitOfWork`.
 * @param serverId - Server identifier from the route path.
 * @param body - Only the fields to change, in route wire values.
 * @returns `{ id, status: "updated" }` for the route's response body.
 * @throws Error when a supplied credential has a missing or blank `displayName`, and whatever the
 *         database client throws when no server has that id.
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
		..._OptionalLastSyncedAt(body.lastSyncedAt),
		credentials: _NormalizeCredentialWrites(body.credentials),
	});

	return { id: serverId, status: "updated" };
}

/** Turn the optional route timestamp into an update fragment: absent leaves `lastSyncedAt` alone, null clears it, a string sets it. */
function _OptionalLastSyncedAt(value: string | null | undefined): { readonly lastSyncedAt: Date | null } | Record<string, never>
{
	if (value === undefined) return {};
	if (value === null) return { lastSyncedAt: null };
	return { lastSyncedAt: new Date(value) };
}

/**
 * Delete an MCP server together with its credential rows.
 *
 * Called by: the `DELETE /:id` handler in `mcpServersRouter` (../routes/mcp-servers.ts), gated by
 * `_RequireOrgAdmin`.
 *
 * @param mutationRepository - Write port; the route passes `PrismaMcpServerMutationUnitOfWork`.
 * @param serverId - Server identifier from the route path.
 * @returns `{ id, status: "deleted" }` for the route's response body.
 * @throws Whatever the database client throws when no server has that id — the route does not
 *         check the row exists first, so a bad id surfaces as a 500 rather than a 404.
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
 * Add one brokered credential row to an MCP server.
 *
 * "Brokered" here means on-behalf-of (OBO): the row stores only an operator-facing label, and the
 * actual secret is held by the Obot gateway, which exchanges it for the calling user at invocation
 * time. Nothing on this path accepts, stores, or returns a secret value.
 *
 * Called by: the `POST /:id/credentials` handler in `mcpServersRouter` (../routes/mcp-servers.ts).
 * That route is deliberately NOT org-admin gated — connecting a credential is a user action.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Server identifier from the route path.
 * @param input - The credential label to store.
 * @returns The created credential row, or null when no server has that id, which the route turns
 *          into a 404.
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
 * Convert one credential label from the route body into the row shape Prisma stores.
 *
 * Label-only by design (see {@link addMcpServerCredential}): there is no field here that could
 * carry a secret, so a caller cannot smuggle one into the database through this path.
 *
 * Called by: {@link addMcpServerCredential} in this file, and
 * src/__tests__/mcp-credential-brokering.test.ts.
 *
 * @param serverId - Owning MCP server identifier.
 * @param credential - The credential label from the route body.
 * @returns The `mcpServerCredential` create input: the owning server id plus the label.
 */
export function _NormalizeCredentialInput(serverId: string, credential: McpServerCredentialInput): Prisma.McpServerCredentialCreateManyInput
{
	return {
		mcpServerId: serverId,
		displayName: credential.displayName,
	};
}

/** Trim every credential label and reject a blank one, before any row is written. */
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
 * Trim each capability label, drop the blanks, and drop duplicates.
 *
 * @param values - Raw capability labels from the request body, or undefined.
 * @returns The kept labels in first-seen order; an empty array when nothing was supplied.
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
