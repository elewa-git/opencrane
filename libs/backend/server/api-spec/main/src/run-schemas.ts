/** Owner-safe run status returned to the signed-in browser. */
export const _SelfRunStatusSchema = {
	type: "object",
	required: ["runId", "attempt", "state", "conversationId", "agentRevisionId", "acceptedAt", "finishedAt"],
	properties: {
		runId: { type: "string" },
		attempt: { type: "integer", minimum: 1 },
		state: { type: "string", enum: ["accepted", "queued", "assigned", "running", "waiting_for_input", "recovery_required", "cancelling", "completed", "failed", "cancelled"] },
		conversationId: { type: "string", nullable: true },
		agentRevisionId: { type: "string" },
		acceptedAt: { type: "string", format: "date-time" },
		finishedAt: { type: "string", format: "date-time", nullable: true },
	},
} as const;

/** Successful owner-requested cancellation response. */
export const _SelfRunCancellationSchema = {
	type: "object",
	required: ["runId", "attempt", "state"],
	additionalProperties: false,
	properties: {
		runId: { type: "string" },
		attempt: { type: "integer", minimum: 1 },
		state: { type: "string", enum: ["cancelling", "cancelled"] },
	},
} as const;
