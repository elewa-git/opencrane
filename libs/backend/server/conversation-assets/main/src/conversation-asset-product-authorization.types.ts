import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import type { ProductAuthorizationRunContext, ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

/** Minimal durable caller coordinate used for artifact product decisions. */
export interface ConversationAssetProductCaller { readonly siloId: string; readonly principalId: string; }

/** Transaction-scoped product checks and owner-grant projection used by conversation assets. */
export interface ConversationAssetProductAuthorizationRepository
{
	/** Checks current read access without admitting a mutation. */
	canAccess(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions.Read): Promise<boolean>;
	/** Records a mutation requested directly by the authenticated person. */
	admit(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	/** Records a generated-file effect with the actual reviewed Pod and saved run coordinates. */
	admitWorkload(caller: ConversationAssetProductCaller, execution: ConversationAssetExecutionContext, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>;
	/** Projects the existing exact owner grants when a new artifact is created. */
	reconcileArtifactOwner(siloId: string, artifactId: string, principalId: string, now: Date): Promise<void>;
}

/** Execution evidence already checked by the run and workload authority in this transaction. */
export interface ConversationAssetExecutionContext
{
	/** Identifies the TokenReview-confirmed Pod and its owning workload object. */
	readonly workload: ProductAuthorizationWorkloadContext;
	/** Identifies the saved run, attempt and immutable agent revision. */
	readonly run: ProductAuthorizationRunContext;
}
