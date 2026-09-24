import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

/** Resolve conversation-file authority only from the verified browser principal. */
export const _ResolveConversationAssetCaller = function _ConversationAssetCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0])
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject, principalId: principal.principalId };
};
