import type { ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";

import type { PromoteGeneratedFileCommand } from "../workflow/generated-file-workflow.types";

/** Content-free coordinates checked in one transaction immediately before byte promotion. */
export type GeneratedFilePromotionAuthorityCommand = Omit<PromoteGeneratedFileCommand, "content">;

/** Exact current fixed lease and deadline returned by the transaction-owned authority. */
export interface GeneratedFilePromotionAuthorityEvidence
{
	/** Original Artifact write lease saved during generated-file capture. */
	readonly lease: ArtifactWriteLeaseClaims;
	/** Original execution deadline reloaded from current authority without extension. */
	readonly notAfterEpochMs: number;
}

/** Transaction owner that fences an already-captured operation immediately before transfer. */
export interface GeneratedFilePromotionAuthority
{
	/**
	 * Reload one exact current operation and its original lease.
	 * Returning null must first durably fail the generated asset and wake both waiting task receipts,
	 * so the workflow cannot leave an Uploading asset after authority ends.
	 */
	admitCurrent(command: GeneratedFilePromotionAuthorityCommand, now: Date): Promise<GeneratedFilePromotionAuthorityEvidence | null>;
}
