import type { PrismaClient } from "@prisma/client";
import type { ArtifactPreprocessControllerAuthority } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _ArtifactPreprocessAuthority } from "./artifact-preprocess-authority";
import { _ArtifactUploadAuthority } from "./artifact-authority";
import type { ArtifactReadLeaseRepository } from "./artifact-read-lease.types";
import type { PersonalArtifactCatalogueRepository } from "./artifact-finalization.types";
import type { ArtifactPreprocessRepository } from "./artifact-preprocessing.types";
import { PrismaArtifactCatalogueRepository } from "./prisma-artifact-catalogue-repository";
import { PrismaArtifactPreprocessUnitOfWork } from "./prisma-artifact-preprocess-unit-of-work";
import { PrismaArtifactPublicationUnitOfWork } from "./prisma-artifact-publication-unit-of-work";

/**
 * Build the upload authority: the lease reservation and the revision commit, each its own transaction.
 *
 * Wiring the unit of work in here is what keeps transaction handling out of the use cases.
 * For PDFs, the workflow engine receives that unit of work's Prisma transaction, so source
 * publication, the preprocessing record, and the saved task receipt commit or roll back together.
 *
 * Called by: `_CreateArtifactUploadGateway` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 *
 * @param prisma - The product database client.
 * @param workflow - Guarded engine that saves PDF tasks within the publication database transaction.
 * @returns An object serving as both the lease repository and the finalization repository,
 *   which reports an exhausted database collision as a `conflict` status rather than throwing.
 */
export function _CreateArtifactUploadAuthority(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">): _ArtifactUploadAuthority
{
	return new _ArtifactUploadAuthority(new PrismaArtifactPublicationUnitOfWork(prisma, workflow));
}

/**
 * Build the preprocessing authority, which opens one transaction per operation.
 *
 * No transaction is ever held across a call to the worker, so a worker that stops responding
 * cannot hold a database lock. The fence on each call is what keeps the job safe instead.
 *
 * Called by: `_CreateArtifactPreprocessOutputBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts, and
 * `_CreateOptionalRuntimeComposition` in apps/opencrane/src/app/runtime-composition.ts.
 *
 * @param prisma - The product database client.
 * @returns The repository the router and both brokers use. Unlike the upload authority, it lets
 *   an exhausted database collision reach the caller, which the router answers as HTTP 503.
 */
export function _CreateArtifactPreprocessAuthority(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "emitEventInTransaction">): ArtifactPreprocessRepository & ArtifactPreprocessControllerAuthority
{
	return new _ArtifactPreprocessAuthority(new PrismaArtifactPreprocessUnitOfWork(prisma, workflow));
}

/**
 * Build the read-only catalogue repository, which needs no transaction.
 *
 * Both of its jobs are plain reads, so it takes no locks and cannot block an upload or a
 * preprocessing claim.
 *
 * Called by: `_CreateSkillAuthoringArtifactReader` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts, and
 * `_CreatePersonalArtifactCatalogueRouter` in prisma-personal-artifact-catalogue.router.ts.
 *
 * @param prisma - The product database client.
 * @returns One object serving both the read-lease lookup and the owner-only asset listing.
 */
export function _CreateArtifactCatalogueRepository(prisma: PrismaClient): ArtifactReadLeaseRepository & PersonalArtifactCatalogueRepository
{
	return new PrismaArtifactCatalogueRepository(prisma);
}
