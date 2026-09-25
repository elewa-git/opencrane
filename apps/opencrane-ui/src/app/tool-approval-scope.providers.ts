import { computed, inject, type Provider } from "@angular/core";

import { SessionStore } from "@opencrane/state/core";
import { OpenCraneToolApprovalScopeGateway, TOOL_APPROVAL_SCOPE_GATEWAY, TOOL_APPROVAL_SCOPE_SESSION, type ToolApprovalScopeSession } from "@opencrane/state/conversation/elicitation";

/** Bind requester-owned standing approval transport and verified session partitioning. */
export function provideToolApprovalScopes(): Provider[]
{
	return [
		{ provide: TOOL_APPROVAL_SCOPE_GATEWAY, useClass: OpenCraneToolApprovalScopeGateway },
		{ provide: TOOL_APPROVAL_SCOPE_SESSION, useFactory: _toolApprovalScopeSession }
	];
}

/** Project only a stable authenticated account and tenant generation into private scope state. */
function _toolApprovalScopeSession(): ToolApprovalScopeSession
{
	const session = inject(SessionStore);
	const scope = computed(function _Scope()
	{
		const user = session.user();
		if (session.me.isLoading() || !session.authenticated() || user === undefined || typeof user.clusterTenant !== "string" || user.clusterTenant.length === 0)
			return null;
		return JSON.stringify([user.sub, user.clusterTenant]);
	});
	return { scope, revalidate: session.reload.bind(session) };
}
