import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { AdmitProductAuthorizationResult } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { ConversationCaller } from "../conversation-caller.types";

/** Transaction-scoped product checks and grant projections used by conversation repositories. */
export interface ConversationProductAuthorizationRepository
{
	/** Applies the Read-class catalogue guard; effect actions require separate admission. */
	canAccess(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions): Promise<boolean>;
	/** Checks current eligibility without recording permission for a protected operation. */
	isCurrentlyEligible(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions): Promise<boolean>;
	admit(caller: ConversationCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	/** Admits the caller's exact selected same-silo Group budget use and returns durable evidence. */
	admitGroupBudget(caller: ConversationCaller, groupId: string, argumentsDigest: `sha256:${string}`, nowEpochMs: number): Promise<AdmitProductAuthorizationResult>;
	entitledIds(caller: ConversationCaller, conversationIds: readonly string[], action: ProductAuthorizationActions): Promise<ReadonlySet<string>>;
	canReadResources(caller: ConversationCaller, resources: readonly ProductAuthorizationResourceLocator[]): Promise<boolean>;
	reconcileParticipants(siloId: string, conversationId: string, participantUserIds: readonly string[], createdByPrincipalId: string, now: Date): Promise<void>;
	reconcileCreator(siloId: string, conversationId: string, creatorPrincipalId: string, now: Date): Promise<void>;
}
