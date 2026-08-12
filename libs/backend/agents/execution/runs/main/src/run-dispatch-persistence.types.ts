import type { AgentControllerRunAttemptClaimLease, AgentControllerRunAttemptProjection } from "@opencrane/contracts";

import { RunDispatchResultStatuses } from "./run-dispatch.types.js";

/** The values needed to mint the model key, returned only once the claim transaction has committed. */
export interface ClaimedAttemptWithMintInputs
{
	/** Database-issued claim generation fencing the delivery. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Narrow attempt projection before the transient model key is attached. */
	readonly attempt: Omit<AgentControllerRunAttemptProjection, "litellmKey">;
	/** Attempt- and delivery-unique LiteLLM alias. */
	readonly keyAlias: string;
	/** Single model alias frozen into the snapshot's server-selected route. */
	readonly modelAlias: string;
	/** Positive US-dollar spend ceiling derived from the snapshot's budget policy. */
	readonly maxBudgetUsd: number;
	/** Whole-second key lifetime bounded to the assignment lifetime. */
	readonly expirySeconds: number;
}

/** Transaction outcome: no eligible work, or a claim awaiting post-commit key minting. */
export type ClaimTransactionResult = { readonly status: RunDispatchResultStatuses.None } | ({ readonly status: RunDispatchResultStatuses.Claimed } & ClaimedAttemptWithMintInputs);

/** Immutable facts used to derive the credential mint inputs while the snapshot is locked. */
export interface RunAttemptCredentialInput
{
	/** Frozen model-route JSON. */
	readonly modelRoute: unknown;
	/** Frozen budget-policy JSON. */
	readonly budgetPolicy: unknown;
	/** Logical run identifier. */
	readonly runId: string;
	/** Positive current attempt number. */
	readonly attempt: number;
	/** Silo that owns the run. */
	readonly siloId: string;
	/** Monotonic outbox delivery generation. */
	readonly deliveryCount: number;
	/** Server-owned assignment lifetime. */
	readonly assignmentTtlMilliseconds: number;
}

/** Credential inputs that do not include the already-built lease and attempt projection. */
export type RunAttemptCredentialMintInputs = Omit<ClaimedAttemptWithMintInputs, "lease" | "attempt">;
