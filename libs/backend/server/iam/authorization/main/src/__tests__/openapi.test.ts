import { describe, expect, it } from "vitest";

import { _AuthorizationOpenapiPaths } from "../openapi.js";

describe("authorization OpenAPI source", function _suite()
{
	it("publishes list, actor-owned read, and exact full-replacement decision paths", function _publishesApprovalContract()
	{
		expect(_AuthorizationOpenapiPaths).toHaveProperty("/me/approvals.get");
		expect(_AuthorizationOpenapiPaths).toHaveProperty("/me/approvals/{approvalRequestId}.get");
		expect(_AuthorizationOpenapiPaths["/me/approvals/{approvalRequestId}/decision"].post.requestBody.content["application/json"].schema).toEqual({ oneOf: [{ type: "object", required: ["decision", "arguments"], additionalProperties: false, properties: { decision: { type: "string", const: "approved" }, arguments: {} } }, { type: "object", required: ["decision"], additionalProperties: false, properties: { decision: { type: "string", const: "denied" } } }] });
	});

	it("documents that actor projections never disclose secret or resume material", function _documentsSafetyBoundary()
	{
		const serialized = JSON.stringify(_AuthorizationOpenapiPaths);
		expect(serialized).toContain("secret-marked values");
		expect(serialized).toContain("resume material");
		expect(serialized).not.toContain("deferredToolResult");
	});
});
