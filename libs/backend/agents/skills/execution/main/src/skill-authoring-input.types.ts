import type { Router } from "express";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapLogger, SkillWorkloadBootstrapTokenReviewer } from "./skill-workload-bootstrap.types.js";
import type { SkillAuthoringInputAuthority } from "./skill-workload-authority.types.js";

/** The artifact ids, read only after every workload check has passed. */
export interface SkillAuthoringInputRecord
{
	/** Silo that owns the workload and the immutable artifact. */
	readonly siloId: string;
	/** ArtifactStore catalog id of the artifact. */
	readonly artifactId: string;
	/** Published immutable artifact revision selected by the draft skill revision. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 address pinned on the draft skill revision. */
	readonly contentAddress: string;
	/** Byte count the artifact reader must confirm before it forwards any bytes. */
	readonly byteLength: number;
	/** Immutable media type that the broker must verify before forwarding. */
	readonly mediaType: string;
}

/** Reads artifact bytes on the server. It creates and uses the ArtifactStore lease itself, and never gives it to a worker. */
export interface SkillAuthoringArtifactReader
{
	/** Returns validated immutable bytes whose metadata matches the selected input record. */
	read(input: SkillAuthoringInputRecord): Promise<ReadableStream<Uint8Array>>;
}

/** Dependencies of the worker-authenticated authoring input route. */
export interface SkillAuthoringInputRouterDependencies
{
	/** Reviews the worker projected token against the route-owned authoring audience. */
	readonly tokenReviewer: SkillWorkloadBootstrapTokenReviewer;
	/** Finds the one artifact this worker may read. */
	readonly authority: SkillAuthoringInputAuthority;
	/** Streams the bytes through the server. It never returns a lease or an ArtifactStore URL to the worker. */
	readonly artifactReader: SkillAuthoringArtifactReader;
	/** Emits structured authority failures without worker credential data. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the authoring-only immutable input route. */
export type CreateSkillAuthoringInputRouter = (dependencies: SkillAuthoringInputRouterDependencies) => Router;
