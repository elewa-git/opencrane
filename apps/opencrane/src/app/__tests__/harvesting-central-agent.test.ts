import { __IsValidCronExpression, __ScheduledRunIdempotencyKey } from "@opencrane/backend/server/agents/scheduling";
import { __FakeObotMcpInvocationAdapter, ObotMcpToolNotAllowedError } from "@opencrane/server/_infra/obot-custody";
import { __AssertMemoryProvenanceComplete, MemoryProvenanceIncompleteError } from "@opencrane/server/_infra/memory-gateway-client";
import type { MemoryProvenance } from "@opencrane/server/_infra/memory-gateway-client";
import { describe, expect, it } from "vitest";

import { _HarvestingCentralAgentDefinition, HARVESTING_ALLOWED_TOOLS } from "../harvesting-central-agent.js";

describe("harvesting central-agent definition", function _DefinitionSuite()
{
	it("is expressible as a valid packaged managed agent", function _Expressible()
	{
		const definition = _HarvestingCentralAgentDefinition("obot-ref-slack-opaque", "global-model-definition");
		expect(definition.content.personaRevisionId).toBeNull();
		expect(definition.content.budget.maxTurns).toBeGreaterThan(0);
		expect(definition.content.budget.maxTokens).toBeGreaterThan(0);
		expect(definition.content.integrationAssignments).toHaveLength(1);
		expect(definition.content.integrationAssignments[0].allowedTools.length).toBeGreaterThan(0);
		expect(definition.content.integrationAssignments[0].custodyReferenceId).toBe("obot-ref-slack-opaque");
		expect(definition.content.scopeAttachments.length).toBeGreaterThan(0);
		expect(__IsValidCronExpression(definition.schedule.cron)).toBe(true);
		expect(definition.schedule.overlapPolicy).toBe("skip");
	});
});

describe("harvesting Obot MCP invocation (stubbed transport)", function _McpSuite()
{
	it("invokes only allow-listed tools through the opaque custody reference", async function _AllowList()
	{
		const definition = _HarvestingCentralAgentDefinition("obot-ref-slack-opaque", "global-model-definition");
		const assignment = definition.content.integrationAssignments[0];
		const transport = new __FakeObotMcpInvocationAdapter({ content: { channels: ["general"] } });
		const result = await transport.invokeTool({ siloId: "silo-1", integrationId: assignment.integrationId, obotCustodyReference: assignment.custodyReferenceId, toolName: "slack.listChannels", arguments: {}, allowedTools: assignment.allowedTools });
		expect(result.content).toEqual({ channels: ["general"] });
		expect(transport.invocations[0].obotCustodyReference).toBe("obot-ref-slack-opaque");
		await expect(transport.invokeTool({ siloId: "silo-1", integrationId: assignment.integrationId, obotCustodyReference: assignment.custodyReferenceId, toolName: "slack.postMessage", arguments: {}, allowedTools: assignment.allowedTools })).rejects.toBeInstanceOf(ObotMcpToolNotAllowedError);
		expect(HARVESTING_ALLOWED_TOOLS).not.toContain("slack.postMessage");
	});
});

describe("harvested record provenance", function _ProvenanceSuite()
{
	it("stamps every injected record with complete central-agent provenance", function _Complete()
	{
		const provenance: MemoryProvenance = { centralAgentId: "svc-harvester", agentRevisionId: "rev-1", runId: "run-42", recordedAt: "2026-07-21T09:00:00.000Z", sourceRef: "slack:C123/1720000000.000100" };
		expect(() => __AssertMemoryProvenanceComplete(provenance)).not.toThrow();
	});
	it("refuses to inject a record missing its run provenance", function _Incomplete()
	{
		const provenance: MemoryProvenance = { centralAgentId: "svc-harvester", agentRevisionId: "rev-1", runId: "", recordedAt: "2026-07-21T09:00:00.000Z", sourceRef: "slack:C123" };
		expect(() => __AssertMemoryProvenanceComplete(provenance)).toThrow(MemoryProvenanceIncompleteError);
	});
});

describe("harvesting scheduled-run identity", function _KeySuite()
{
	it("derives a deterministic idempotency key per scheduled slot", function _Deterministic()
	{
		const a = __ScheduledRunIdempotencyKey("svc-harvester", "rev-1", "2026-07-21T09:00:00.000Z");
		const b = __ScheduledRunIdempotencyKey("svc-harvester", "rev-1", "2026-07-21T09:00:00.000Z");
		expect(a).toBe(b);
	});
});
