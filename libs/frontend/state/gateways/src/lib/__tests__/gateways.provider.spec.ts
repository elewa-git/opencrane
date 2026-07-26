import { describe, expect, it } from "vitest";
import { ClassProvider, InjectionToken, Provider, ValueProvider } from "@angular/core";

import { CONVERSATION_GATEWAY } from "@opencrane/state/core";
import { OpenClawConversationGateway } from "@opencrane/state/conversation/adapter";
import { OpenCraneSettingsGateway, SETTINGS_GATEWAY } from "@opencrane/state/settings/adapter";
import { OpenCraneUserTenantGateway, USER_TENANT_GATEWAY } from "@opencrane/state/tenant/adapter";
import { MCP_GATEWAY, OpenCraneMcpGateway } from "@opencrane/state/mcp/adapter";
import { OpenCranePersonalAssetsGateway, PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";

import { GATEWAY_MODE } from "../gateway-mode.types";
import { provideControlPlaneGateways } from "../control-plane-gateways.provider";
import {
	MockConversationGateway,
	MockMcpGateway,
	MockSettingsGateway,
	MockUserTenantGateway,
	MockPersonalAssetsGateway,
	provideTestGateways
} from "../__test__/test-gateways.provider";

/**
 * Resolves the `useClass` bound to a token within a provider list.
 *
 * @param providers The provider array under test.
 * @param token The injection token to look up.
 * @returns The class bound via `useClass` for that token.
 */
function classFor(providers: Provider[], token: InjectionToken<unknown>): unknown
{
	const match = providers.find(function isToken(provider): provider is ClassProvider
	{
		return typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token;
	});

	return (match as ClassProvider).useClass;
}

/**
 * Resolves the `useValue` bound to a token within a provider list.
 *
 * @param providers The provider array under test.
 * @param token The injection token to look up.
 * @returns The value bound via `useValue` for that token.
 */
function valueFor(providers: Provider[], token: InjectionToken<unknown>): unknown
{
	const match = providers.find(function isToken(provider): provider is ValueProvider
	{
		return typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token;
	});

	return (match as ValueProvider).useValue;
}

describe("provideControlPlaneGateways", () =>
{
	it("binds the live opencrane-ui (org-admin) gateways and reports live mode", () =>
	{
		const providers = provideControlPlaneGateways();

		expect(classFor(providers, CONVERSATION_GATEWAY)).toBe(OpenClawConversationGateway);
		expect(classFor(providers, SETTINGS_GATEWAY)).toBe(OpenCraneSettingsGateway);
		expect(classFor(providers, USER_TENANT_GATEWAY)).toBe(OpenCraneUserTenantGateway);
		expect(classFor(providers, MCP_GATEWAY)).toBe(OpenCraneMcpGateway);
		expect(classFor(providers, PERSONAL_ASSETS_GATEWAY)).toBe(OpenCranePersonalAssetsGateway);
		expect(valueFor(providers, GATEWAY_MODE)).toBe("live");
	});
});

describe("provideTestGateways", () =>
{
	it("binds every swappable gateway to its in-memory fixture and reports mock mode", () =>
	{
		const providers = provideTestGateways();

		expect(classFor(providers, CONVERSATION_GATEWAY)).toBe(MockConversationGateway);
		expect(classFor(providers, SETTINGS_GATEWAY)).toBe(MockSettingsGateway);
		expect(classFor(providers, USER_TENANT_GATEWAY)).toBe(MockUserTenantGateway);
		expect(classFor(providers, MCP_GATEWAY)).toBe(MockMcpGateway);
		expect(classFor(providers, PERSONAL_ASSETS_GATEWAY)).toBe(MockPersonalAssetsGateway);
		expect(valueFor(providers, GATEWAY_MODE)).toBe("mock");
	});
});
