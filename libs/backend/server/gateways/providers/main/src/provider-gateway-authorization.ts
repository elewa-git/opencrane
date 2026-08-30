import type { Request, Response } from "express";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ProviderGatewayAuthorizationError, type ProviderGatewayAdministrationAdmission, type ProviderGatewayCaller, type ProviderGatewayCallerResolver } from "./provider-gateway-authority.types";

/** Isolates exact creator grants for model and provider resources. */
const _PROVIDER_RESOURCE_CREATOR_MANAGER_ID = "provider-resource-creator-bootstrap";

/** Resolve a provider-gateway caller from the admitted local Principal and trusted request host. */
export function _ResolveProviderGatewayCaller(request: Request): ProviderGatewayCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/** Fail closed when the authenticated request cannot be bound to a durable local Principal. */
export function _RequireProviderGatewayCaller(request: Request, response: Response, resolveCaller: ProviderGatewayCallerResolver): ProviderGatewayCaller | null
{
	const caller = resolveCaller(request);
	if (caller !== null)
		return caller;
	response.status(403).json({ error: "Organization identity is required", code: "FORBIDDEN_NO_SILO" });
	return null;
}

/** Require explicit organisation-policy administration and record it in the protected transaction. */
export async function _RequireProviderGatewayAdministration(authorization: AuthorizationAuthority, caller: ProviderGatewayCaller, argumentsValue: unknown): Promise<ProviderGatewayAdministrationAdmission>
{
	const argumentsDigest = ___DigestCanonicalJson(argumentsValue as JsonValue);
	const admission = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs: Date.now() });
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow || admission.evidence === null)
		throw new ProviderGatewayAuthorizationError();
	return { argumentsDigest, evidence: admission.evidence };
}

/** Projects exact read and use grants for a newly created provider resource. */
export async function _GrantProviderResourceCreatorUse(authorization: AuthorizationAuthority, caller: ProviderGatewayCaller, resource: ProductAuthorizationResourceLocator, now: Date): Promise<void>
{
	const grants = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Use].map(function _Grant(action)
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error(`provider creator capability is missing for ${resource.kind}:${action}`);
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: caller.principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: caller.principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: caller.principalId } as const;
	});
	const replacement = await authorization.replaceManagedGrants({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, managerId: _PROVIDER_RESOURCE_CREATOR_MANAGER_ID, resource, grants, now, nowEpochMs: now.getTime() });
	if (replacement.outcome !== AuthorizationDecisionOutcomes.Allow)
		throw new ProviderGatewayAuthorizationError();
}

/** Convert the central authority's deny result into the fixed gateway response. */
export function _SendProviderGatewayAuthorizationError(error: unknown, response: Response): boolean
{
	if (!(error instanceof ProviderGatewayAuthorizationError))
		return false;
	response.status(403).json({ error: error.message, code: "FORBIDDEN" });
	return true;
}
