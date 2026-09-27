/** Authenticated coordinates accepted structurally from the scheduling package. */
export interface RoutineDirectoryCaller
{
	readonly siloId: string;
	readonly principalId: string;
	readonly issuer: string;
	readonly subjectId: string;
}

/** Transaction-scoped conversation owner used by routine creation and authorized projections. */
export interface RoutineConversationDirectoryRepository
{
	resolveAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, participantRefs: readonly string[], now: Date): Promise<{ readonly participantRefs: readonly string[]; readonly principalIds: readonly string[] } | null>;
	projectAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, principalIds: readonly string[]): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[]>;
	creationAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, now: Date): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[] | null>;
	readableConversationIds(caller: RoutineDirectoryCaller, conversationIds: readonly string[], now: Date): Promise<readonly string[]>;
}
