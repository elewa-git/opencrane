import type { AuthorizationAuthority, ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, __ProductAuthorizationCapability, type ProductAuthorizationActions, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import { CompanyAssistantProvisioningDenied } from "./company-assistant.errors";

/** Requires recorded central authority before publishing durable assistant authority. */
export async function _AdmitCompanyAssistantChange(authorization: AuthorizationAuthority, caller: { readonly siloId: string; readonly principalId: string }, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsDigest: `sha256:${string}`, now: Date): Promise<void>
{
	const decision = await authorization.admitPrincipal({ ...caller, actorKind: "user", actorId: caller.principalId, resource, action, argumentsDigest, nowEpochMs: now.getTime() });
	if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
		throw new CompanyAssistantProvisioningDenied();
}

/** Derives one exact grant for selected human invokers or the assistant's own model and tool use. */
export function _CompanyAssistantGrant(principalId: string, createdByPrincipalId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions): ManagedAuthorizationGrantSpec
{
	const capability = __ProductAuthorizationCapability(resource.kind, action);
	if (capability === null)
		throw new CompanyAssistantProvisioningDenied();
	return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId };
}
