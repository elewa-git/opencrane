import type { JsonValue } from "@opencrane/util";

import type { ArtifactStorePromotionReceipt } from "../artifact-finalization.types";

/** A verified promotion submitted for scanning after the caller checks current write authority. */
export interface QuarantineArtifactRevisionCommand
{
	/** Silo that owns both the logical artifact and its existing write lease. */
	readonly siloId: string;
	/** Existing logical artifact receiving its first revision. */
	readonly artifactId: string;
	/** Stable revision identifier retained across receipt recovery. */
	readonly artifactRevisionId: string;
	/** Requester subject recorded as the author of the revision. */
	readonly createdBy: string;
	/** Content-free origin facts compared again on replay. */
	readonly provenance: JsonValue;
	/** Signature-verified receipt; every field must also match the stored lease. */
	readonly promotion: ArtifactStorePromotionReceipt;
}

/** Submission outcomes describe scanning admission, never permission to read unscanned bytes. */
export enum ArtifactQuarantineOutcomes
{
	/** The receipt, quarantined revision and one scan job were saved together. */
	Accepted = "accepted",
	/** The exact revision and scan job were already saved; scanning may have progressed. */
	Idempotent = "idempotent",
	/** A missing, expired or conflicting coordinate prevented all writes. */
	Denied = "denied",
}

/** Owns artifact receipt consumption and scan admission inside the caller's transaction. */
export interface ArtifactQuarantineRepository
{
	/** Save one first revision for scanning without updating the artifact's current revision. */
	finalize(command: QuarantineArtifactRevisionCommand): Promise<ArtifactQuarantineOutcomes>;
}
