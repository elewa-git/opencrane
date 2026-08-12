/** Actor-safe deferred tool approval schema shared by the generated API contract. */
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
