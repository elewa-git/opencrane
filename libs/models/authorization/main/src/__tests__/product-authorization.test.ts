import { describe, expect, it } from "vitest";

import { __ProductAuthorizationCapability, __ProductAuthorizationCapabilityId, __ProductAuthorizationRule, PRODUCT_AUTHORIZATION_CAPABILITIES, PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_RULES } from "../product-authorization";
import { ProductAuthorizationActions, ProductAuthorizationEvidenceKinds, ProductAuthorizationResourceKinds } from "../product-authorization.types";

describe("product authorization catalogue", function _Suite()
{
	it("assigns one stable capability and evidence rule to a supported resource action", function _SupportedRule()
	{
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.McpToolRevision, ProductAuthorizationActions.Invoke);
		expect(capability).toEqual({
			catalog: { catalogId: "opencrane-product-authorization", revision: 1, digest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST },
			capabilityId: "mcp-tool-revision:invoke",
		});
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.McpToolRevision, ProductAuthorizationActions.Invoke)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Effect);
	});

	it("rejects an action that the resource catalogue does not support", function _UnsupportedRule()
	{
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.Group, ProductAuthorizationActions.Invoke)).toBeNull();
		expect(__ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Group, ProductAuthorizationActions.Invoke)).toBeNull();
	});

	it("contains no duplicate resource-action coordinates", function _UniqueCoordinates()
	{
		const coordinates = PRODUCT_AUTHORIZATION_RULES.map(rule => __ProductAuthorizationCapabilityId(rule.resourceKind, rule.action));
		expect(new Set(coordinates).size).toBe(coordinates.length);
	});

	it("publishes each rule as one immutable capability-catalog entry", function _CatalogPayload()
	{
		expect(PRODUCT_AUTHORIZATION_CAPABILITIES).toHaveLength(PRODUCT_AUTHORIZATION_RULES.length);
		expect(PRODUCT_AUTHORIZATION_CAPABILITIES[0]).toMatchObject({ id: expect.stringContaining(":"), actions: [expect.any(String)], evidence: expect.any(String) });
	});

	it("marks catalogue reads, mutations, and external effects with distinct evidence", function _EvidenceClasses()
	{
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.Skill, ProductAuthorizationActions.Discover)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Read);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.SkillRevision, ProductAuthorizationActions.Publish)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.SkillRevision, ProductAuthorizationActions.Use)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Effect);
	});

	it("uses typed collection resources for authorization before a new resource id exists", function _CreationRoots()
	{
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.ArtifactCollection, ProductAuthorizationActions.Create)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.ConversationCollection, ProductAuthorizationActions.Create)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.PersonaCollection, ProductAuthorizationActions.Create)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
	});

	it("protects an MCP task before complete arguments create its ToolInvocation", function _McpTaskLifecycle()
	{
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.McpTask, ProductAuthorizationActions.Read)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Read);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.McpTask, ProductAuthorizationActions.Edit)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.McpTask, ProductAuthorizationActions.Cancel)?.evidence).toBe(ProductAuthorizationEvidenceKinds.Decision);
		expect(__ProductAuthorizationRule(ProductAuthorizationResourceKinds.McpTask, ProductAuthorizationActions.Invoke)).toBeNull();
	});
});
