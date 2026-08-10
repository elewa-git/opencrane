import { _RuntimeSteeringOpenapiPaths } from "@opencrane/backend/agents/execution/protocol";
import { _SelfRunStatusOpenapiPaths } from "@opencrane/backend/agents/execution/runs";
import { _PersonalConfigurationOpenapiPaths } from "@opencrane/backend/agents/personal/configuration";
import { _PersonaOnboardingOpenapiPaths } from "@opencrane/backend/agents/personal/personas";
import { _AgentServicesOpenapiPaths } from "@opencrane/backend/server/agents/agent-services";
import { _PersonalArtifactsOpenapiPaths } from "@opencrane/backend/server/agents/artifacts";
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

/** Domain-owned OpenAPI paths merged in deliberate JSON-serialization order by the API specification. */
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
	..._AgentServicesOpenapiPaths,
	..._PersonalConfigurationOpenapiPaths,
	..._SkillCatalogueOpenapiPaths,
	..._PersonalArtifactsOpenapiPaths,
};
