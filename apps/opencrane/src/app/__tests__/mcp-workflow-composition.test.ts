import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { McpEraProbeFailureCodes } from "@opencrane/backend/server/gateways/mcp";
import { McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "@opencrane/backend/server/infra/mcp-era-probe";

import { __DeclareSkillAuthoringValidation, _McpEraProbeFailure } from "../mcp-workflow-composition";

describe("MCP workflow application translation", function _McpWorkflowTranslationSuite()
{
	it("declares the remote skill validation task before a server transaction can admit it", function _DeclaresRemoteSkillValidation()
	{
		const declare = vi.fn();
		__DeclareSkillAuthoringValidation({ declare });
		expect(declare).toHaveBeenCalledWith(SkillAuthoringValidationTaskDeclaration);
	});

	it.each([
		new McpEraProbeTransportError("network"),
		new McpEraProbeTransportError("timeout"),
		new McpEraProbeTransportError("http_429"),
		new McpEraProbeTransportError("http_503"),
	])("maps %s to a retryable domain failure", function _Retryable(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.RetryableUnavailable);
	});

	it.each([
		new McpEraProbeConfigurationError("unsafe_address"),
		new McpEraProbeConfigurationError("invalid_endpoint"),
	])("maps %s to an unsafe endpoint rejection", function _Unsafe(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.UnsafeEndpoint);
	});

	it.each([
		new McpEraProbeProtocolError("malformed_discovery"),
		new McpEraProbeTransportError("redirect"),
		new McpEraProbeTransportError("oversize"),
		new McpEraProbeTransportError("http_404"),
	])("maps %s to an invalid-response rejection", function _Invalid(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.NotMcpServer);
	});
});
