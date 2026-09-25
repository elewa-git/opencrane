import { MCP_PROTOCOL_VERSION, McpConnectionCredentialKinds, McpConnectionFailureCodes, McpCredentialRequirement, type McpDiscoveredTool } from "@opencrane/contracts";
import { McpRemoteAuthorizationKinds, McpRemoteConfigurationError, McpRemoteProtocolError, McpRemoteTransportError, type McpRemoteAuthorization, type McpRemoteClient } from "@opencrane/backend/server/infra/mcp-remote-client";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { McpAuthenticatedConnectionDiscoveryOutcomes, McpRemoteRevisionFinalizationOutcomes } from "./mcp-authenticated-connection-discovery.types";
import type { McpAuthenticatedConnectionDiscovery, McpAuthenticatedConnectionDiscoveryInput, McpAuthenticatedConnectionDiscoveryResult, McpRemoteRevisionFinalizer } from "./mcp-authenticated-connection-discovery.types";
import { __McpConnectionEndpointDigest } from "../mcp-connection-digests";
import { McpConnectionStates } from "../mcp-connection.types";

const _MAXIMUM_PAGES = 32;
const _MAXIMUM_TOOLS = 512;

/** Performs bounded authenticated discovery before handing one complete result to SQL. */
export class StandardMcpAuthenticatedConnectionDiscovery implements McpAuthenticatedConnectionDiscovery
{
	/** Standard remote client shared with catalogue probing and invocation execution. */
	private readonly _client: McpRemoteClient;
	/** Transaction owner that rechecks the generation after network work finishes. */
	private readonly _finalizer: McpRemoteRevisionFinalizer;

	/** Bind the one transport and finalizer used by this discovery owner. */
	constructor(client: McpRemoteClient, finalizer: McpRemoteRevisionFinalizer)
	{
		this._client = client;
		this._finalizer = finalizer;
	}

	/** @inheritdoc */
	async activate(input: McpAuthenticatedConnectionDiscoveryInput): Promise<McpAuthenticatedConnectionDiscoveryResult>
	{
		if (!_InputIsBound(input))
			return _Failure(McpConnectionFailureCodes.AuthorityEnded);
		const authorization = _Authorization(input);
		try
		{
			const discovery = await this._client.discover({ endpoint: input.endpoint, authorization, signal: input.signal });
			if (discovery.protocolVersion !== MCP_PROTOCOL_VERSION)
				return _Failure(McpConnectionFailureCodes.UnsupportedProtocol);
			const tools: McpDiscoveredTool[] = [];
			const names = new Set<string>();
			const cursors = new Set<string>();
			let cursor: string | undefined;
			for (let pageNumber = 1; pageNumber <= _MAXIMUM_PAGES; pageNumber += 1)
			{
				const page = await this._client.listTools({ endpoint: input.endpoint, authorization, cursor, signal: input.signal });
				if (page.cacheScope !== discovery.cacheScope || tools.length + page.tools.length > _MAXIMUM_TOOLS || page.tools.some(function _Duplicate(tool) { return names.has(tool.name); }))
					return _Failure(McpConnectionFailureCodes.DiscoveryRejected);
				for (const tool of page.tools)
				{
					names.add(tool.name);
					tools.push(tool);
				}
				if (page.nextCursor === null)
				{
					const orderedTools = tools.toSorted(function _ByName(first, second) { return first.name.localeCompare(second.name); });
					const discoveryDigest = ___DigestCanonicalJson({ protocolVersion: discovery.protocolVersion, evidenceDigest: discovery.evidenceDigest, cacheScope: discovery.cacheScope, tools: orderedTools } as unknown as JsonValue);
					const result = await this._finalizer.finalize({ record: input.record, task: input.task, protocolVersion: discovery.protocolVersion, discoveryEvidenceDigest: discovery.evidenceDigest, discoveryDigest, tools: orderedTools });
					if (result.outcome === McpRemoteRevisionFinalizationOutcomes.Completed || result.outcome === McpRemoteRevisionFinalizationOutcomes.Replayed)
						return { outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Completed, serverRevisionId: result.serverRevisionId };
					return _Failure(result.outcome === McpRemoteRevisionFinalizationOutcomes.Denied ? McpConnectionFailureCodes.AuthorityEnded : McpConnectionFailureCodes.DiscoveryRejected);
				}
				if (cursors.has(page.nextCursor))
					return _Failure(McpConnectionFailureCodes.DiscoveryRejected);
				cursors.add(page.nextCursor);
				cursor = page.nextCursor;
			}
			return _Failure(McpConnectionFailureCodes.DiscoveryRejected);
		}
		catch (error)
		{
			if (error instanceof McpRemoteProtocolError || error instanceof McpRemoteConfigurationError)
				return _Failure(McpConnectionFailureCodes.DiscoveryRejected);
			if (error instanceof McpRemoteTransportError)
			{
				if (error.code === "http_401" || error.code === "http_403")
					return _Failure(McpConnectionFailureCodes.AuthenticationRejected);
				return { outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Retryable };
			}
			throw error;
		}
	}
}

/** Refuse stale workflow, endpoint, owner, or credential coordinates before DNS work. */
function _InputIsBound(input: McpAuthenticatedConnectionDiscoveryInput): boolean
{
	const record = input.record;
	const taskMatches = input.task.taskId === record.task.taskId && input.task.taskName === record.task.taskName && input.task.idempotencyKey === record.task.taskKey;
	if (!taskMatches || record.state !== McpConnectionStates.Activating || __McpConnectionEndpointDigest(input.endpoint) !== record.endpointDigest || input.credential.kind !== record.credentialKind)
		return false;
	if (input.credential.kind === McpConnectionCredentialKinds.None)
		return record.credentialRequirement === McpCredentialRequirement.Credentialless && record.secretRef === null && record.secretUid === null && record.secretResourceVersion === null;
	return record.credentialRequirement !== McpCredentialRequirement.Credentialless && record.secretRef !== null && record.secretUid !== null && record.secretResourceVersion !== null;
}

/** Add bearer authorization only when the admitted connection owns bearer material. */
function _Authorization(input: McpAuthenticatedConnectionDiscoveryInput): McpRemoteAuthorization | undefined
{
	if (input.credential.kind === McpConnectionCredentialKinds.None)
		return undefined;
	return { kind: McpRemoteAuthorizationKinds.Bearer, token: input.credential.token };
}

/** Return one bounded failure without remote response material. */
function _Failure(failureCode: McpConnectionFailureCodes): McpAuthenticatedConnectionDiscoveryResult
{
	return { outcome: McpAuthenticatedConnectionDiscoveryOutcomes.DefiniteFailure, failureCode };
}
