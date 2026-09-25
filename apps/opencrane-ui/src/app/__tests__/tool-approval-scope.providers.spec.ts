import { Injector, signal } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "@opencrane/state/core";
import { OpenCraneToolApprovalScopeGateway, TOOL_APPROVAL_SCOPE_GATEWAY, TOOL_APPROVAL_SCOPE_SESSION } from "@opencrane/state/conversation/elicitation";

import { provideToolApprovalScopes } from "../tool-approval-scope.providers";

describe("Tool approval scope app composition", function _ToolApprovalScopeComposition()
{
	it("binds the requester-owned generated-client adapter", function _GatewayBinding()
	{
		expect(provideToolApprovalScopes()).toContainEqual({ provide: TOOL_APPROVAL_SCOPE_GATEWAY, useClass: OpenCraneToolApprovalScopeGateway });
	});

	it("partitions private rows by stable identity and purges while identity is unavailable", function _SessionPartition()
	{
		const authenticated = signal(false);
		const loading = signal(false);
		const user = signal<{ sub: string; clusterTenant?: string } | undefined>(undefined);
		const reload = vi.fn();
		const injector = Injector.create({ providers: [...provideToolApprovalScopes(), { provide: SessionStore, useValue: { authenticated, user, me: { isLoading: loading }, reload } }] });
		const session = injector.get(TOOL_APPROVAL_SCOPE_SESSION);
		expect(session.scope()).toBeNull();
		user.set({ sub: "jane", clusterTenant: "nairobi" });
		authenticated.set(true);
		expect(session.scope()).toBe(JSON.stringify(["jane", "nairobi"]));
		loading.set(true);
		expect(session.scope()).toBeNull();
		loading.set(false);
		user.set({ sub: "jane" });
		expect(session.scope()).toBeNull();
		session.revalidate();
		expect(reload).toHaveBeenCalledOnce();
	});
});
