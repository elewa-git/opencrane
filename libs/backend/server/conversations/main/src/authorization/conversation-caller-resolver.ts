import type { Request } from "express";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import type { ConversationCaller } from "./conversation-caller.types";

/** Resolves conversation authority only from verified request identity and authentication evidence. */
export function _ResolveConversationCaller(request: Request): ConversationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null || principal.verifiedAuthenticationAt === null
		? null
		: { siloId: principal.siloId, subjectId: principal.externalSubject, principalId: principal.principalId, externalIssuer: principal.externalIssuer, verifiedAuthenticationAt: principal.verifiedAuthenticationAt.toISOString() };
}
