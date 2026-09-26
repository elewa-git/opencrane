/** Selects routine scheduling coordinates shared by command and firing repositories. */
export const _ROUTINE_SELECT = {
	id: true,
	siloId: true,
	originalRequesterPrincipalId: true,
	requesterIssuer: true,
	requesterSubjectId: true,
	requesterAuthenticatedAt: true,
	destinationConversationId: true,
	selectedManagedServiceId: true,
	status: true,
	currentRevision: true,
	lifecycleRevision: true,
	automaticEnabledAfter: true,
	lastAutomaticOccurrence: true,
	nextAutomaticOccurrence: true,
	scheduleTaskId: true,
	scheduleTaskName: true,
	scheduleTaskKey: true,
} as const;

/** Selects immutable revision material without ever loading plaintext. */
export const _ROUTINE_REVISION_SELECT = {
	id: true,
	siloId: true,
	routineId: true,
	revision: true,
	scheduleExpression: true,
	scheduleTimezone: true,
	instructionKeyId: true,
	instructionNonce: true,
	instructionAuthTag: true,
	instructionCiphertext: true,
	instructionCiphertextDigest: true,
	audiencePrincipalIds: true,
	createdByPrincipalId: true,
	createdAt: true,
} as const;
