import { RunToolProgressPhases } from "@opencrane/contracts";

/** Owner-safe run status returned to the signed-in browser. */
export const _SelfRunStatusSchema = {
	type: "object",
	required: ["runId", "attempt", "state", "conversationId", "agentRevisionId", "acceptedAt", "finishedAt", "latestTool"],
	properties: {
		runId: { type: "string" },
		attempt: { type: "integer", minimum: 1 },
		state: { type: "string", enum: ["accepted", "queued", "assigned", "running", "waiting_for_input", "recovery_required", "cancelling", "cancelled", "completed", "failed"] },
		latestTool: { type: "object", nullable: true, additionalProperties: false, required: ["phase"], properties: { phase: { type: "string", enum: Object.values(RunToolProgressPhases) } } },
		conversationId: { type: "string", nullable: true },
		agentRevisionId: { type: "string" },
		acceptedAt: { type: "string", format: "date-time" },
		finishedAt: { type: "string", format: "date-time", nullable: true },
	},
} as const;
