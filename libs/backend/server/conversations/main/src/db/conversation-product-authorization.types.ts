import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { ProductAuthorizationAdmissionEvidence } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { ConversationCaller } from "../types/conversation-caller.types";

/** Transaction-scoped product checks and grant projections used by conversation repositories. */
export interface ConversationProductAuthorizationRepository
{
	canAccess(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions): Promise<boolean>;
	admit(caller: ConversationCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	admitEvidence(caller: ConversationCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<ProductAuthorizationAdmissionEvidence | null>;
	entitledIds(caller: ConversationCaller, conversationIds: readonly string[], action: ProductAuthorizationActions): Promise<ReadonlySet<string>>;
	canReadResources(caller: ConversationCaller, resources: readonly ProductAuthorizationResourceLocator[]): Promise<boolean>;
	reconcileParticipants(siloId: string, conversationId: string, participantUserIds: readonly string[], createdByPrincipalId: string, now: Date): Promise<void>;
	reconcileCreator(siloId: string, conversationId: string, creatorPrincipalId: string, now: Date): Promise<void>;
}
