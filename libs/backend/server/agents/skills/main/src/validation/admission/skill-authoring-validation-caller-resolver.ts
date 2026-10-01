import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

/** Resolve skill validation authority only from the verified browser Principal and its silo. */
export const _ResolveSkillAuthoringValidationCaller = function _SkillAuthoringValidationCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0])
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
};
