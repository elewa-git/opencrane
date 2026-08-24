import { createHash } from "node:crypto";
import { isIP } from "node:net";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpRemoteServerRegistrationOutcomes } from "./mcp-era-probe.types";
import type { McpEraProbeWorkflow, McpRemoteServerRegistrationCommand, McpRemoteServerRegistrationResult } from "./mcp-era-probe.types";
import { ___McpRemoteServerRegistrationSchema } from "./mcp-remote-registration.validator";

/** Host names that browsers and cloud runtimes commonly resolve inside the local trust boundary. */
const _BLOCKED_HOST_NAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);

/** Error returned when a registration cannot safely become remote catalogue input. */
export class McpRemoteServerRegistrationValidationError extends Error
{
	/** Create a validation error whose message contains no remote response data. */
	constructor(message: string)
	{
		super(message);
		this.name = "McpRemoteServerRegistrationValidationError";
	}
}

/** Return a SHA-256 field suitable for database equality without retaining its source value. */
function _Digest(value: unknown): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Reject an endpoint name that cannot identify a public remote MCP server. */
function _AssertPublicHostName(hostname: string): void
{
	const withoutTrailingDot = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
	const lower = withoutTrailingDot.toLowerCase();
	const address = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
	if (isIP(address) !== 0
		|| _BLOCKED_HOST_NAMES.has(lower)
		|| lower.endsWith(".localhost")
		|| lower.endsWith(".local")
		|| lower.endsWith(".internal"))
	{
		throw new McpRemoteServerRegistrationValidationError("MCP server endpoint must use a public DNS name.");
	}
}

/** Normalize a public HTTPS endpoint before it becomes catalogue state or task input. */
function _Endpoint(value: string): string
{
	let endpoint: URL;
	try
	{
		endpoint = new URL(value);
	}
	catch
	{
		throw new McpRemoteServerRegistrationValidationError("MCP server endpoint must be a valid public HTTPS URL.");
	}
	if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "")
	{
		throw new McpRemoteServerRegistrationValidationError("MCP server endpoint must be a public HTTPS URL without embedded credentials.");
	}
	if (endpoint.search !== "" || endpoint.hash !== "")
	{
		throw new McpRemoteServerRegistrationValidationError("MCP server endpoint must not include a query or fragment.");
	}
	_AssertPublicHostName(endpoint.hostname);
	return endpoint.toString();
}

/** Create or return one draft server and admit its era-probe task in the same transaction. */
export function registerRemoteServer(unitOfWork: McpOperatorUnitOfWork, workflow: McpEraProbeWorkflow, caller: McpOperatorCaller, command: McpRemoteServerRegistrationCommand): Promise<McpRemoteServerRegistrationResult>
{
	const parsed = ___McpRemoteServerRegistrationSchema.safeParse(command);
	if (!parsed.success)
	{
		throw new McpRemoteServerRegistrationValidationError("MCP server registration fields are invalid.");
	}
	const { idempotencyKey, name } = parsed.data;
	const description = parsed.data.description ?? "";
	const endpoint = _Endpoint(parsed.data.endpoint);
	const registrationKeyDigest = _Digest([caller.siloId, idempotencyKey]);
	const registrationDigest = _Digest([name, description, endpoint]);

	return unitOfWork.execute(async function _Register(transaction): Promise<McpRemoteServerRegistrationResult>
	{
		const stored = await transaction.mcp.createOrFindRemoteServer({ siloId: caller.siloId, name, description, endpoint, registrationKeyDigest, registrationDigest });
		if (!stored || stored.server.registrationDigest !== registrationDigest)
		{
			return { outcome: McpRemoteServerRegistrationOutcomes.Conflict };
		}

		const server = stored.server;
		if (stored.created)
		{
			await transaction.mcp.appendAudit("Created", `McpServer/${server.id}`, `Remote MCP server ${server.id} registered for protocol check`, { siloId: caller.siloId, actorPrincipalId: caller.principalId });
		}
		await workflow.admit(transaction.workflowTransaction, { siloId: caller.siloId, serverId: server.id, registrationDigest });
		return { outcome: McpRemoteServerRegistrationOutcomes.Registered, server: { id: server.id, name: server.name, endpoint: server.endpoint, eraProbeStatus: server.eraProbeStatus } };
	});
}
