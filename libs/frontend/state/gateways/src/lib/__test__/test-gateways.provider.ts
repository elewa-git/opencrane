import { Provider } from "@angular/core";

import { CONVERSATION_GATEWAY } from "@opencrane/state/core";
import { SETTINGS_GATEWAY } from "@opencrane/state/settings/adapter";
import { USER_TENANT_GATEWAY } from "@opencrane/state/tenant/adapter";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { PROVIDER_KEY_GATEWAY } from "@opencrane/state/provider-key/adapter";
import { PERSONAL_ASSETS_GATEWAY } from "@opencrane/state/assets/adapter";

import { GATEWAY_MODE } from "../gateway-mode.types";
import { MockConversationGateway } from "./mock-conversation-gateway";
import { MockMcpGateway } from "./mock-mcp-gateway";
import { MockProviderKeyGateway } from "./mock-provider-key-gateway";
import { MockSettingsGateway } from "./mock-settings-gateway";
import { MockUserTenantGateway } from "./mock-tenant-gateway";
import { MockPersonalAssetsGateway } from "./mock-personal-assets-gateway";

export { MockConversationGateway } from "./mock-conversation-gateway";
export { MockMcpGateway } from "./mock-mcp-gateway";
export { MockProviderKeyGateway } from "./mock-provider-key-gateway";
export { MockSettingsGateway } from "./mock-settings-gateway";
export { MockUserTenantGateway } from "./mock-tenant-gateway";
export { MockPersonalAssetsGateway } from "./mock-personal-assets-gateway";

/**
 * Binds every swappable gateway to its in-memory fixture implementation.
 * For use in tests only — never imported by production app code.
 */
export function provideTestGateways(): Provider[]
{
	return [
		{ provide: GATEWAY_MODE, useValue: "mock" },
		{ provide: CONVERSATION_GATEWAY, useClass: MockConversationGateway },
		{ provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway },
		{ provide: USER_TENANT_GATEWAY, useClass: MockUserTenantGateway },
		{ provide: MCP_GATEWAY, useClass: MockMcpGateway },
		{ provide: PROVIDER_KEY_GATEWAY, useClass: MockProviderKeyGateway },
		{ provide: PERSONAL_ASSETS_GATEWAY, useClass: MockPersonalAssetsGateway }
	];
}
