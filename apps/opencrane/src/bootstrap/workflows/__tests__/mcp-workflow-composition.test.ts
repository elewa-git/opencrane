import { describe, expect, it, vi } from "vitest";

import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { McpEraProbeFailureCodes } from "@opencrane/backend/server/gateways/mcp";
import { McpRemoteDeliveryStates, McpRemoteConfigurationError, McpRemoteProtocolError, McpRemoteTransportError } from "@opencrane/backend/server/infra/mcp-remote-client";

import { __DeclareArtifactPreprocessTask, __DeclareSkillAuthoringValidation } from "../mcp-workflow-composition";
import { _McpEraProbeFailure } from "@opencrane/backend/server/gateways/mcp";

describe("MCP workflow application translation", function _McpWorkflowTranslationSuite()
{
	it("declares the remote skill validation task before a server transaction can admit it", function _DeclaresRemoteSkillValidation()
	{
		const declare = vi.fn();
		__DeclareSkillAuthoringValidation({ declare });
		expect(declare).toHaveBeenCalledWith(SkillAuthoringValidationTaskDeclaration);
	});

	it("declares the remote artifact task before a publication transaction can admit it", function _DeclaresRemoteArtifactPreprocessing()
	{
		const declare = vi.fn();
		__DeclareArtifactPreprocessTask({ declare });
		expect(declare).toHaveBeenCalledWith(ArtifactPreprocessTaskDeclaration);
	});

	it.each([
		new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched),
		new McpRemoteTransportError("timeout", McpRemoteDeliveryStates.MaybeDispatched),
		new McpRemoteTransportError("http_429", McpRemoteDeliveryStates.MaybeDispatched),
		new McpRemoteTransportError("http_503", McpRemoteDeliveryStates.MaybeDispatched),
	])("maps %s to a retryable domain failure", function _Retryable(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.RetryableUnavailable);
	});

	it.each([
		new McpRemoteConfigurationError("unsafe_address"),
		new McpRemoteConfigurationError("invalid_endpoint"),
	])("maps %s to an unsafe endpoint rejection", function _Unsafe(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.UnsafeEndpoint);
	});

	it.each([
		new McpRemoteProtocolError("malformed_discovery"),
		new McpRemoteTransportError("redirect", McpRemoteDeliveryStates.MaybeDispatched),
		new McpRemoteTransportError("oversize", McpRemoteDeliveryStates.MaybeDispatched),
		new McpRemoteTransportError("http_404", McpRemoteDeliveryStates.MaybeDispatched),
	])("maps %s to an invalid-response rejection", function _Invalid(error)
	{
		expect(_McpEraProbeFailure(error).code).toBe(McpEraProbeFailureCodes.NotMcpServer);
	});
});
