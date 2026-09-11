import { Provider } from "@angular/core";

import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { PROVIDER_KEY_GATEWAY } from "@opencrane/state/provider-key/adapter";
import { PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";
import { SKILL_CATALOGUE_GATEWAY } from "@opencrane/state/skills/adapter";

import { MockMcpGateway } from "./mock-mcp-gateway";
import { MockProviderKeyGateway } from "./mock-provider-key-gateway";
import { MockPersonalAssetsGateway } from "./mock-personal-assets-gateway";
import { MockSkillCatalogueGateway } from "./mock-skill-catalogue-gateway";

export { MockMcpGateway } from "./mock-mcp-gateway";
export { MockProviderKeyGateway } from "./mock-provider-key-gateway";
export { MockPersonalAssetsGateway } from "./mock-personal-assets-gateway";
export { MockSkillCatalogueGateway } from "./mock-skill-catalogue-gateway";

/**
 * Binds every swappable gateway to its in-memory fixture implementation.
 * For use in tests only — never imported by production app code.
 */
export function provideTestGateways(): Provider[]
{
	return [
		{ provide: MCP_GATEWAY, useClass: MockMcpGateway },
		{ provide: PROVIDER_KEY_GATEWAY, useClass: MockProviderKeyGateway },
		{ provide: PERSONAL_ASSETS_GATEWAY, useClass: MockPersonalAssetsGateway },
		{ provide: SKILL_CATALOGUE_GATEWAY, useClass: MockSkillCatalogueGateway }
	];
}
