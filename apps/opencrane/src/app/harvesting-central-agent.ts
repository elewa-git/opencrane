import type { HarvestingCentralAgentDefinition } from "./harvesting-central-agent.types.js";

/**
 * The packaged "harvesting" central agent, expressed entirely as OpenCrane definition data.
 *
 * This proves the bespoke `apps/feat-central-agents` harvester is expressible as a managed
 * AgentService: a Draft `AgentRevision` referencing an Obot MCP integration assignment (an opaque
 * custody reference + an allow-list of the exact tools it may call), Cognee dataset/scope targets as
 * revision-scope attachments, and a recurring schedule. It authors DATA only — no live Obot call, no
 * run. The live-Obot end-to-end proof (and the subsequent deletion of `apps/feat-central-agents`,
 * its bespoke connector, and the `HarvestingCursor` table) is a NAMED LATER GATE tracked under #337.
 */
/** The Obot MCP tools the harvester is permitted to invoke; nothing outside this list is callable. */
export const HARVESTING_ALLOWED_TOOLS: readonly string[] = ["slack.listChannels", "slack.getChannelHistory"];

/**
 * Build the harvesting central-agent definition.
 *
 * @param obotCustodyReference - Opaque Obot custody reference for the Slack integration (never a
 *   credential); provided by the composition root once custody is provisioned.
 * @param modelDefinitionId - Registered global model definition selected by the composition root.
 * @returns The packaged managed-agent definition and its schedule spec.
 */
export function _HarvestingCentralAgentDefinition(obotCustodyReference: string, modelDefinitionId: string): HarvestingCentralAgentDefinition
{
	return {
		name: "Knowledge Harvester",
		workloadProfile: "managed-harvester",
		content: {
			promptPolicyVersion: "harvester-prompt-v1",
			// A managed (central) agent never carries a persona.
			personaRevisionId: null,
			modelDefinitionId,
			budget: { maxTurns: 20, maxTokens: 200_000, maxCostUsdMicros: 5_000_000, maxDurationMs: 900_000 },
			skills: [],
			// One Obot MCP integration with a strict tool allow-list; only these tools are invocable.
			integrationAssignments: [{ integrationId: "slack", custodyReferenceId: obotCustodyReference, allowedTools: [...HARVESTING_ALLOWED_TOOLS] }],
			// Cognee dataset/scope targets the harvester reads from and promotes into.
			scopeAttachments: [
				{ scope: "org", subjectType: "tenant", subjectId: "default" },
				{ scope: "project", subjectType: "group", subjectId: "harvest-intake" },
			],
		},
		// Run hourly; catch up any slot missed in the last day; never overlap a still-running harvest.
		schedule: { cron: "0 * * * *", timezone: "UTC", overlapPolicy: "skip", enabled: true, catchupWindowSeconds: 86_400 },
	};
}
