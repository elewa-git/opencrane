import type { AgentControllerRunAttemptClaimLease, AgentControllerRunAttemptProjection } from "@opencrane/contracts";

import { RunDispatchResultStatuses } from "./run-dispatch.types.js";

/** Frozen credential inputs returned only after an attempt claim transaction commits. */
export interface ClaimedAttemptWithMintInputs
{
	/** Database-issued claim generation fencing the delivery. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Narrow attempt projection without either transient key. */
	readonly attempt: Omit<AgentControllerRunAttemptProjection, "litellmKey">;
	/** Attempt- and delivery-unique LiteLLM alias. */
	readonly keyAlias: string;
	/** Single model alias frozen into the snapshot's server-selected route. */
	readonly modelAlias: string;
	/** Positive US-dollar spend ceiling derived from the snapshot's budget policy. */
	readonly maxBudgetUsd: number;
	/** Whole-second key lifetime bounded to the assignment lifetime. */
	readonly expirySeconds: number;
	/** Integrations frozen into the snapshot, scoping an optional attempt Obot key. */
	readonly obotIntegrationIds: readonly string[];
	/** Attempt- and delivery-unique Obot key name derived from immutable claim coordinates. */
	readonly obotKeyName: string;
	/** Hard Obot key expiry bounded to the assignment lifetime. */
	readonly obotKeyExpiresAt: Date;
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
	/** Frozen integration-assignment JSON. */
	readonly integrationAssignments: unknown;
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
	/** Database claim instant bounding the Obot key. */
	readonly claimedAt: Date;
}

/** Credential inputs that do not include the already-built lease and attempt projection. */
export type RunAttemptCredentialMintInputs = Omit<ClaimedAttemptWithMintInputs, "lease" | "attempt">;
