import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { McpOperatorCaller } from "./mcp-operator.logic.types";

/** Denotes a central authorization denial without exposing grant details to an API caller. */
export class McpOperatorAuthorizationError extends Error
{
	/** Create the fixed denial returned by MCP governance routes. */
	constructor()
	{
		super("MCP governance permission is required.");
		this.name = "McpOperatorAuthorizationError";
	}
}

/** Requires the current Organization/Administer grant for one read-only governance view. */
export async function __RequireMcpOrganizationAdministrationRead(authorization: AuthorizationAuthority, caller: McpOperatorCaller): Promise<void>
{
	const entitled = await authorization.listPrincipalEntitled({
		siloId: caller.siloId,
		principalId: caller.principalId,
		action: ProductAuthorizationActions.Administer,
		resources: [{ kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }],
		nowEpochMs: Date.now(),
	});
	if (entitled.length !== 1)
		throw new McpOperatorAuthorizationError();
}

/** Admits one MCP governance mutation under the current Organization/Administer grant. */
export async function __RequireMcpOrganizationAdministration(authorization: AuthorizationAuthority, caller: McpOperatorCaller, argumentsValue: JsonValue): Promise<void>
{
	const admission = await authorization.admitPrincipal({
		siloId: caller.siloId,
		principalId: caller.principalId,
		actorKind: "user",
		actorId: caller.principalId,
		resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId },
		action: ProductAuthorizationActions.Administer,
		argumentsDigest: ___DigestCanonicalJson(argumentsValue),
		nowEpochMs: Date.now(),
	});
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
		throw new McpOperatorAuthorizationError();
}
