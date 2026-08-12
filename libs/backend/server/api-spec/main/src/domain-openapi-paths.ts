import { _RuntimeSteeringOpenapiPaths } from "@opencrane/backend/agents/execution/protocol";
import { _SelfRunStatusOpenapiPaths } from "@opencrane/backend/agents/execution/runs";
import { _PersonalConfigurationOpenapiPaths } from "@opencrane/backend/agents/personal/configuration";
import { _PersonaOnboardingOpenapiPaths } from "@opencrane/backend/agents/personal/personas";
import { _AgentServicesOpenapiPaths } from "@opencrane/backend/server/agents/agent-services";
import { _PersonalArtifactsOpenapiPaths } from "@opencrane/backend/server/agents/artifacts";
import { _ConversationAssetsOpenapiPaths } from "@opencrane/backend/server/conversation-assets";
import { _SelfConversationReplayOpenapiPaths, _SelfConversationsOpenapiPaths } from "@opencrane/backend/server/conversations";
import { _SkillCatalogueOpenapiPaths } from "@opencrane/backend/server/agents/skills";
import { _UserOnboardingOpenapiPaths } from "@opencrane/backend/server/agents/onboarding";
import { _McpOpenapiPaths } from "@opencrane/backend/server/gateways/mcp";
import { _ModelRoutingOpenapiPaths } from "@opencrane/backend/server/gateways/model-routing";
import { _ProvidersOpenapiPaths } from "@opencrane/backend/server/gateways/providers";
import { _AuditOpenapiPaths } from "@opencrane/backend/server/iam/audit";
import { _AuthorizationOpenapiPaths } from "@opencrane/backend/server/iam/authorization";
import { _GrantsOpenapiPaths } from "@opencrane/backend/server/iam/grants";
import { _GroupsOpenapiPaths } from "@opencrane/backend/server/iam/groups";
import { _RetrievalOpenapiPaths } from "@opencrane/backend/server/knowledge/retrieval";
import { _SpendOpenapiPaths } from "@opencrane/backend/server/reporting/spend";

/**
 * Every domain package's own OpenAPI paths, merged into one object.
 *
 * Each package documents the routes it serves, next to the code that serves them, and this file
 * is the only place that knows about all of them. The spread order is deliberate: it is the
 * order the paths appear in the emitted `openapi.json`, so reordering these lines produces a
 * large diff in the generated document and the generated client without changing the API at
 * all. Add a new domain at the end.
 *
 * Called by: spec.ts, which spreads this into `paths` before its own auth and meta routes.
 */
export const _DomainOpenapiPaths = {
	..._McpOpenapiPaths,
	..._GrantsOpenapiPaths,
	..._GroupsOpenapiPaths,
	..._RetrievalOpenapiPaths,
	..._ProvidersOpenapiPaths,
	..._ModelRoutingOpenapiPaths,
	..._SpendOpenapiPaths,
	..._AuditOpenapiPaths,
	..._AuthorizationOpenapiPaths,
	..._RuntimeSteeringOpenapiPaths,
	..._SelfRunStatusOpenapiPaths,
	..._PersonaOnboardingOpenapiPaths,
	..._UserOnboardingOpenapiPaths,
	..._SelfConversationReplayOpenapiPaths,
	..._SelfConversationsOpenapiPaths,
	..._ConversationAssetsOpenapiPaths,
	..._AgentServicesOpenapiPaths,
	..._PersonalConfigurationOpenapiPaths,
	..._SkillCatalogueOpenapiPaths,
	..._PersonalArtifactsOpenapiPaths,
};
