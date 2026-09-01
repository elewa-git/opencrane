import type { LiteLlmModelDeploymentTarget } from "@opencrane/backend/server/gateways/model-routing";

import type { DeleteByokKeyEffectPayload } from "./provider-effect-command.types";

/** Provider credential fields needed by the BYOK HTTP adapter without exposing Prisma rows. */
export interface ProviderByokStatusRecord
{
	/** Governed provider-connection identifier. */
	readonly id: string;
	/** Silo that owns the provider connection. */
	readonly siloId: string;
	/** Provider catalogue key such as `openai`. */
	readonly provider: string;
	/** Fixed LiteLLM credential name, or null when registration never completed. */
	readonly litellmCredentialName: string | null;
	/** Time the provider connection last changed. */
	readonly updatedAt: Date;
}

/**
 * Outcomes of planning provider retirement inside the authorization transaction.
 *
 * The route branches on these in-memory values before admitting a command. They are not persisted
 * or sent over the public API. The set is closed: an unknown value must not admit external deletion.
 */
export enum ProviderRetirementPlanStatuses
{
	/** A selected or frozen model still depends on the provider, so no command may be admitted. */
	Governed = "governed",
	/** Every provider model is unused and its exact retirement inputs are frozen in this result. */
	Ready = "ready",
}

/** Closed provider-retirement plan returned from current product state. */
export type ProviderRetirementPlan =
	| { readonly status: ProviderRetirementPlanStatuses.Governed; readonly reason: string }
	| {
		readonly status: ProviderRetirementPlanStatuses.Ready;
		readonly reason: null;
		/** Timestamp used to bind the command to the provider generation it inspected. */
		readonly credentialUpdatedAt: Date | null;
		/** Whether LiteLLM accepted the credential and therefore requires live model cleanup. */
		readonly litellmRegistered: boolean;
		/** Model-definition rows removed only after their live deployments are gone. */
		readonly modelDefinitionIds: readonly string[];
		/** Deployment identities and coordinates the command may remove from LiteLLM. */
		readonly deployments: readonly LiteLlmModelDeploymentTarget[];
	};

/** Transaction-scoped provider reads and retirement planning used by the BYOK route. */
export interface ProviderByokRepository
{
	/** Lists credential status rows for an already-authorized provider set. */
	listStatuses(siloId: string, providers: readonly string[]): Promise<readonly ProviderByokStatusRecord[]>;
	/** Loads one governed provider connection after the route rechecks its current Read grant. */
	findStatus(siloId: string, providerConnectionId: string): Promise<ProviderByokStatusRecord | null>;
	/** Freezes every unused provider model and refuses selected or agent-referenced state. */
	planRetirement(siloId: string, provider: string): Promise<ProviderRetirementPlan>;
	/** Rechecks that the provider and every model still equal the admitted retirement payload. */
	isRetirementEligible(siloId: string, payload: DeleteByokKeyEffectPayload): Promise<boolean>;
	/** Deletes the exact model rows and provider credential after external retirement completes. */
	persistRetirement(siloId: string, payload: DeleteByokKeyEffectPayload): Promise<void>;
}
