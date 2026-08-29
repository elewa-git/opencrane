import type { Request, Response } from "express";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ModelRoutingAuthorizationError, type ModelRoutingCaller, type ModelRoutingCallerResolver } from "./model-routing-authorization.types";

/** Resolve routing-policy authority from the admitted Principal and trusted request host. */
export function _ResolveModelRoutingCaller(request: Request): ModelRoutingCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/** Fail closed when the request cannot be bound to a durable local Principal. */
export function _RequireModelRoutingCaller(request: Request, response: Response, resolveCaller: ModelRoutingCallerResolver): ModelRoutingCaller | null
{
	const caller = resolveCaller(request);
	if (caller !== null)
		return caller;
	response.status(403).json({ error: "Organization identity is required", code: "FORBIDDEN_NO_SILO" });
	return null;
}

/** Check exact organisation-policy administration without recording read evidence. */
export async function _CanAdministerModelRouting(authorization: AuthorizationAuthority, caller: ModelRoutingCaller): Promise<boolean>
{
	const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Administer, resources: [{ kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }], nowEpochMs: Date.now() });
	return entitled.length === 1;
}

/** Admit a routing-policy mutation and record its decision in the protected transaction. */
export async function _RequireModelRoutingAdministration(authorization: AuthorizationAuthority, caller: ModelRoutingCaller, argumentsValue: unknown): Promise<void>
{
	const admission = await authorization.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: caller.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest: ___DigestCanonicalJson(argumentsValue as JsonValue), nowEpochMs: Date.now() });
	if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
		throw new ModelRoutingAuthorizationError();
}

/** Convert central authority denial into the fixed routing-policy response. */
export function _SendModelRoutingAuthorizationError(error: unknown, response: Response): boolean
{
	if (!(error instanceof ModelRoutingAuthorizationError))
		return false;
	response.status(403).json({ error: error.message, code: "FORBIDDEN" });
	return true;
}
