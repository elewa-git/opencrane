import { describe, expect, it } from "vitest";
import { ClassProvider, InjectionToken, Provider } from "@angular/core";

import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";
import { SKILL_CATALOGUE_GATEWAY } from "@opencrane/state/skills/adapter";

import {
	MockMcpGateway,
	MockPersonalAssetsGateway,
	MockSkillCatalogueGateway,
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

describe("provideTestGateways", () =>
{
	it("binds every swappable gateway to its in-memory fixture", () =>
	{
		const providers = provideTestGateways();

		expect(classFor(providers, MCP_GATEWAY)).toBe(MockMcpGateway);
		expect(classFor(providers, PERSONAL_ASSETS_GATEWAY)).toBe(MockPersonalAssetsGateway);
		expect(classFor(providers, SKILL_CATALOGUE_GATEWAY)).toBe(MockSkillCatalogueGateway);
	});
});
