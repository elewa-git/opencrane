import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

/** Minimal durable caller coordinate used for artifact product decisions. */
export interface ConversationAssetProductCaller { readonly siloId: string; readonly principalId: string; }

/** Transaction-scoped product checks and owner-grant projection used by conversation assets. */
export interface ConversationAssetProductAuthorizationRepository
{
	canAccess(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions): Promise<boolean>;
	admit(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	admitAs(caller: ConversationAssetProductCaller, actorKind: "user" | "agent-service" | "workload" | "system", actorId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	reconcileArtifactOwner(siloId: string, artifactId: string, principalId: string, now: Date): Promise<void>;
}
