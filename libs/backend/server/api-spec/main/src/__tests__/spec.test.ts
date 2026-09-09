import { describe, expect, it } from "vitest";

import { RunToolProgressPhases } from "@opencrane/contracts";

import { spec } from "../spec";

describe("MCP public API contract", function _Suite()
{
	it("publishes only the principal- and silo-bound MCP surface", function _Test()
	{
		expect(spec.paths).toHaveProperty("/mcp/catalog");
		expect(spec.paths).toHaveProperty("/mcp/servers");
		expect(spec.paths).not.toHaveProperty("/mcp-servers");
		expect(spec.paths).not.toHaveProperty("/mcp-servers/{id}");
		expect(spec.paths).toHaveProperty("/mcp/tasks");
		expect(spec.paths).toHaveProperty("/mcp/tasks/{id}");
		expect(spec.paths).toHaveProperty("/mcp/tasks/{id}/input");
		expect(spec.components.schemas).not.toHaveProperty("McpServerCredential");
		expect(spec.components.schemas.McpCatalogServer.required).toContain("tools");
		expect(spec.components.schemas.McpAssignableToolRevision).toMatchObject({
			required: ["toolRevisionId", "serverRevisionId", "name", "description", "inputSchema", "inputSchemaDigest", "eligibility", "readiness"],
			properties: {
				description: { type: ["string", "null"] },
				eligibility: { enum: ["assignable", "governance-blocked"] },
				readiness: { enum: ["ready"] },
			},
		});
	});
});


describe("personal run progress API contract", function _ProgressSuite()
{
	it("requires nullable phase-only progress without adding metadata or action controls", function _PhaseOnly()
	{
		const status = spec.components.schemas.SelfRunStatus;
		expect(status.required).toContain("latestTool");
		expect(status.properties.latestTool).toEqual({ type: "object", nullable: true, additionalProperties: false, required: ["phase"], properties: { phase: { type: "string", enum: Object.values(RunToolProgressPhases) } } });
	});
});
