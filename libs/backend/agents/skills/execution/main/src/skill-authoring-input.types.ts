import type { Router } from "express";

import type { SkillWorkloadBootstrapIdentity, SkillWorkloadBootstrapLogger, SkillWorkloadBootstrapTokenReviewer } from "./skill-workload-bootstrap.types.js";

/** Immutable artifact coordinates selected only after authoring-workload fencing succeeds. */
export interface SkillAuthoringInputRecord
{
	/** Silo that owns the workload and the immutable artifact. */
	readonly siloId: string;
	/** Logical ArtifactStore catalog identity. */
	readonly artifactId: string;
	/** Published immutable artifact revision selected by the draft skill revision. */
	readonly artifactRevisionId: string;
	/** Canonical SHA-256 address pinned on the draft skill revision. */
	readonly contentAddress: string;
	/** Exact immutable byte count that the broker must verify before forwarding. */
	readonly byteLength: number;
	/** Immutable media type that the broker must verify before forwarding. */
	readonly mediaType: string;
}

/** Postgres boundary that selects an authoring input only for its exact reviewed worker Pod. */
export interface SkillAuthoringInputRepository
{
	/** Loads the still-eligible draft artifact after all workload, bootstrap, and artifact fences hold. */
	loadForWorker(workloadId: string, identity: SkillWorkloadBootstrapIdentity): Promise<SkillAuthoringInputRecord | null>;
}

/** Server-owned byte broker; it mints and consumes the ArtifactStore lease without exposing it to workers. */
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
	/** Selects the only durable artifact coordinates that worker may read. */
	readonly repository: SkillAuthoringInputRepository;
	/** Brokers bytes through the server without returning a lease or ArtifactStore endpoint. */
	readonly artifactReader: SkillAuthoringArtifactReader;
	/** Emits structured authority failures without worker credential data. */
	readonly logger: SkillWorkloadBootstrapLogger;
}

/** Factory producing the authoring-only immutable input route. */
export type CreateSkillAuthoringInputRouter = (dependencies: SkillAuthoringInputRouterDependencies) => Router;
