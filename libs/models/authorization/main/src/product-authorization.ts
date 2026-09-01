import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { CapabilityReference } from "./capability.types";
import { ProductAuthorizationActions, ProductAuthorizationEvidenceKinds, ProductAuthorizationResourceKinds, type ProductAuthorizationCapabilityDefinition, type ProductAuthorizationRule } from "./product-authorization.types";

/** Stable identifier for the built-in product capability catalogue. */
export const PRODUCT_AUTHORIZATION_CATALOG_ID = "opencrane-product-authorization";

/** First revision that defines the complete typed resource and action vocabulary. */
export const PRODUCT_AUTHORIZATION_CATALOG_REVISION = 1;

/** Declares the actions and receipt class supported by each product resource. */
export const PRODUCT_AUTHORIZATION_RULES: readonly ProductAuthorizationRule[] = [
	..._Rules(ProductAuthorizationResourceKinds.Organization, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.Organization, [ProductAuthorizationActions.Edit, ProductAuthorizationActions.Manage, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.AuthorizationGrant, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.AuthorizationGrant, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Revoke, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.AgentService, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.AgentService, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Schedule, ProductAuthorizationActions.Retire, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.AgentService, [ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Delegate], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.AgentRevision, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.AgentRevision, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Assign, ProductAuthorizationActions.Revoke], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.AgentRun, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.AgentRun, [ProductAuthorizationActions.Cancel, ProductAuthorizationActions.Retry], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.ToolInvocation, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ToolInvocation, [ProductAuthorizationActions.Invoke], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.ApprovalRequest, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ApprovalRequest, [ProductAuthorizationActions.Decide], ProductAuthorizationEvidenceKinds.Decision),
	..._PackageRules(ProductAuthorizationResourceKinds.Skill),
	..._RevisionRules(ProductAuthorizationResourceKinds.SkillRevision),
	..._PackageRules(ProductAuthorizationResourceKinds.McpServer),
	..._RevisionRules(ProductAuthorizationResourceKinds.McpServerRevision),
	..._Rules(ProductAuthorizationResourceKinds.McpToolRevision, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.McpToolRevision, [ProductAuthorizationActions.Assign], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.McpToolRevision, [ProductAuthorizationActions.Use, ProductAuthorizationActions.Invoke], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.ModelDefinition, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ModelDefinition, [ProductAuthorizationActions.Assign, ProductAuthorizationActions.Manage, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.ModelDefinition, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	..._ContentRules(ProductAuthorizationResourceKinds.Artifact),
	..._Rules(ProductAuthorizationResourceKinds.ArtifactCollection, [ProductAuthorizationActions.Create], ProductAuthorizationEvidenceKinds.Decision),
	..._ContentRules(ProductAuthorizationResourceKinds.ArtifactRevision),
	..._ContentRules(ProductAuthorizationResourceKinds.Dataset),
	..._Rules(ProductAuthorizationResourceKinds.MemoryScope, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.MemoryScope, [ProductAuthorizationActions.Share, ProductAuthorizationActions.Manage, ProductAuthorizationActions.Forget], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.MemoryScope, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	..._ContentRules(ProductAuthorizationResourceKinds.Persona),
	..._Rules(ProductAuthorizationResourceKinds.Conversation, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.Conversation, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Share, ProductAuthorizationActions.Delete, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.Conversation, [ProductAuthorizationActions.Use, ProductAuthorizationActions.Delegate], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.ConversationCollection, [ProductAuthorizationActions.Create], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.ChannelTarget, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ChannelTarget, [ProductAuthorizationActions.Manage, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.ChannelTarget, [ProductAuthorizationActions.Send], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.ProviderConnection, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ProviderConnection, [ProductAuthorizationActions.Manage, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.ProviderConnection, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.Schedule, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.Schedule, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Schedule, ProductAuthorizationActions.Delete, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.Budget, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.Budget, [ProductAuthorizationActions.Manage, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.Budget, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	..._Rules(ProductAuthorizationResourceKinds.AuditLog, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.TokenUsage, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._ContentRules(ProductAuthorizationResourceKinds.ThirdPartySource),
	..._Rules(ProductAuthorizationResourceKinds.ResourceShare, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.ResourceShare, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Revoke, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.Group, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.Group, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Delete, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.OrganizationMembership, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.OrganizationMembership, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Revoke, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.McpTask, [ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
	..._Rules(ProductAuthorizationResourceKinds.McpTask, [ProductAuthorizationActions.Edit, ProductAuthorizationActions.Cancel], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.PersonaCollection, [ProductAuthorizationActions.Create], ProductAuthorizationEvidenceKinds.Decision),
	..._Rules(ProductAuthorizationResourceKinds.AgentServiceCollection, [ProductAuthorizationActions.Create], ProductAuthorizationEvidenceKinds.Decision),
];

/** Exact immutable payload installed in the shared capability-catalog table. */
export const PRODUCT_AUTHORIZATION_CAPABILITIES: readonly ProductAuthorizationCapabilityDefinition[] = PRODUCT_AUTHORIZATION_RULES.map(rule => ({ id: __ProductAuthorizationCapabilityId(rule.resourceKind, rule.action), resourceKind: rule.resourceKind, actions: [rule.action], evidence: rule.evidence }));

/** Canonical digest that binds every built-in capability reference to the persisted payload. */
export const PRODUCT_AUTHORIZATION_CATALOG_DIGEST = ___DigestCanonicalJson(PRODUCT_AUTHORIZATION_CAPABILITIES as unknown as JsonValue);

/** Builds the stable capability identifier for one resource action. */
export function __ProductAuthorizationCapabilityId(resourceKind: ProductAuthorizationResourceKinds, action: ProductAuthorizationActions): string
{
	return `${resourceKind}:${action}`;
}

/** Resolves one reviewed catalogue rule or returns null for an unsupported action. */
export function __ProductAuthorizationRule(resourceKind: ProductAuthorizationResourceKinds, action: ProductAuthorizationActions): ProductAuthorizationRule | null
{
	return PRODUCT_AUTHORIZATION_RULES.find(rule => rule.resourceKind === resourceKind && rule.action === action) ?? null;
}

/** Builds the immutable capability reference used by grants and decisions. */
export function __ProductAuthorizationCapability(resourceKind: ProductAuthorizationResourceKinds, action: ProductAuthorizationActions): CapabilityReference | null
{
	const rule = __ProductAuthorizationRule(resourceKind, action);
	if (rule === null)
	{
		return null;
	}

	return {
		catalog: {
			catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID,
			revision: PRODUCT_AUTHORIZATION_CATALOG_REVISION,
			digest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST,
		},
		capabilityId: __ProductAuthorizationCapabilityId(resourceKind, action),
	};
}

/** Creates rules that share one resource kind and evidence requirement. */
function _Rules(resourceKind: ProductAuthorizationResourceKinds, actions: readonly ProductAuthorizationActions[], evidence: ProductAuthorizationEvidenceKinds): readonly ProductAuthorizationRule[]
{
	return actions.map(action => ({ resourceKind, action, evidence }));
}

/** Creates the stable identity-level rules shared by MCP and skill packages. */
function _PackageRules(resourceKind: ProductAuthorizationResourceKinds): readonly ProductAuthorizationRule[]
{
	return [
		..._Rules(resourceKind, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
		..._Rules(resourceKind, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Install, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Revoke, ProductAuthorizationActions.Retire, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
	];
}

/** Creates the immutable revision rules shared by MCP and skill package revisions. */
function _RevisionRules(resourceKind: ProductAuthorizationResourceKinds): readonly ProductAuthorizationRule[]
{
	return [
		..._Rules(resourceKind, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
		..._Rules(resourceKind, [ProductAuthorizationActions.Assign, ProductAuthorizationActions.Review, ProductAuthorizationActions.Publish, ProductAuthorizationActions.Revoke], ProductAuthorizationEvidenceKinds.Decision),
		..._Rules(resourceKind, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	];
}

/** Creates rules shared by content resources without making their lifecycle one aggregate. */
function _ContentRules(resourceKind: ProductAuthorizationResourceKinds): readonly ProductAuthorizationRule[]
{
	return [
		..._Rules(resourceKind, [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read], ProductAuthorizationEvidenceKinds.Read),
		..._Rules(resourceKind, [ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Share, ProductAuthorizationActions.Delete, ProductAuthorizationActions.Administer], ProductAuthorizationEvidenceKinds.Decision),
		..._Rules(resourceKind, [ProductAuthorizationActions.Use], ProductAuthorizationEvidenceKinds.Effect),
	];
}
