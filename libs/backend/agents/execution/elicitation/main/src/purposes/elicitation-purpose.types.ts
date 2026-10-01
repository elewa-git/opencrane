import type { ElicitationPurposes, ElicitationResponseValue, RunInputSnapshot } from "@opencrane/contracts";
import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";

import type { OpenElicitationCommand, PersonalMemoryPermissionVerificationResult } from "../elicitation.types";

/** Supplies the saved request fields needed to apply or expire its purpose. */
export interface ElicitationPurposeRequest
{
	/** Identifies the saved question. */
	readonly id: string;
	/** Identifies the run paused by the question. */
	readonly runId: string;
	/** Identifies the attempt that asked the question. */
	readonly attempt: number;
	/** Carries server-selected purpose details that clients cannot replace. */
	readonly purposePayload: unknown;
	/** Detects changes to the saved purpose details. */
	readonly purposePayloadDigest: string;
	/** Identifies the participant allowed to answer. */
	readonly assignedParticipantId: string;
	/** Limits how long the participant can answer. */
	readonly expiresAt: Date;
}

/** Applies a response or expiry using the transaction that owns the request. */
export interface ElicitationPurposeStrategy
{
	/** Apply an authorised response; false requires the coordinator to roll back the transaction. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>;
	/** Finish purpose-specific work before the request is marked Expired. */
	expire(request: ElicitationPurposeRequest, now: Date): Promise<void>;
}

/** Requires an implementation for every purpose persisted with a request. */
export type ElicitationPurposeStrategies = Readonly<Record<ElicitationPurposes, ElicitationPurposeStrategy>>;

/** Adds question construction and receipt verification to the memory permission response rules. */
export interface PersonalMemoryPermissionPurpose extends ElicitationPurposeStrategy
{
	/** Build the protected question without opening a request or reading memory content. */
	createOpenCommand(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): OpenElicitationCommand | null;
	/** Verify the receipt against the active dispatch claim without consuming either. */
	verify(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>;
}
