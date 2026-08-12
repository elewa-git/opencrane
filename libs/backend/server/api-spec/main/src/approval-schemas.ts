/**
 * A tool call waiting for the signed-in user's decision, as it appears in the API.
 *
 * Only what the person deciding needs is here: which run and attempt, which tool, the arguments
 * being proposed, the schema their answer must satisfy, and when the request expires. There is
 * deliberately no tool output, no provider detail, and no other user's context — it is shaped
 * for the person being asked, not for an operator.
 *
 * `attempt` matters when answering: an approval belongs to one attempt of a run, so a decision
 * carrying a stale attempt must be refused rather than applied to a newer one.
 *
 * Registered as the `SelfDeferredToolApproval` component by spec.ts, which means it also shapes
 * the generated frontend client.
 */
export const _SelfDeferredToolApprovalSchema = {
	type: "object",
	required: ["approvalRequestId", "runId", "attempt", "toolRevisionId", "toolInvocationId", "state", "proposedArguments", "responseSchema", "expiresAt", "createdAt"],
	properties: {
		approvalRequestId: { type: "string" },
		runId: { type: "string" },
		attempt: { type: "integer", minimum: 1 },
		toolRevisionId: { type: "string" },
		toolInvocationId: { type: "string" },
		state: { type: "string", enum: ["pending", "approved", "denied", "expired", "cancelled"] },
		proposedArguments: { nullable: true },
		responseSchema: { type: "object" },
		expiresAt: { type: "string", format: "date-time" },
		createdAt: { type: "string", format: "date-time" },
	},
} as const;
