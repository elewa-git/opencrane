import type { PrismaClient } from "@prisma/client";

import { _ArtifactPreprocessAuthority } from "./artifact-preprocess-authority.js";
import { _ArtifactUploadAuthority } from "./artifact-authority.js";
import type { ArtifactReadLeaseRepository } from "./artifact-read-lease.types.js";
import type { PersonalArtifactCatalogueRepository } from "./artifact-finalization.types.js";
import type { ArtifactPreprocessRepository } from "./artifact-preprocessing.types.js";
import { PrismaArtifactCatalogueRepository } from "./prisma-artifact-catalogue-repository.js";
import { PrismaArtifactPreprocessUnitOfWork } from "./prisma-artifact-preprocess-unit-of-work.js";
import { PrismaArtifactPublicationUnitOfWork } from "./prisma-artifact-publication-unit-of-work.js";

/** Composes the two short publication transactions that surround external artifact-service promotion. */
export function _CreateArtifactUploadAuthority(prisma: PrismaClient): _ArtifactUploadAuthority
{
	return new _ArtifactUploadAuthority(new PrismaArtifactPublicationUnitOfWork(prisma));
}

/** Composes durable preprocessing transitions whose private transactions never cross worker I/O. */
export function _CreateArtifactPreprocessAuthority(prisma: PrismaClient): ArtifactPreprocessRepository
{
	return new _ArtifactPreprocessAuthority(new PrismaArtifactPreprocessUnitOfWork(prisma));
}

/** Composes read-only catalogue facts without acquiring publication or worker locks. */
export function _CreateArtifactCatalogueRepository(prisma: PrismaClient): ArtifactReadLeaseRepository & PersonalArtifactCatalogueRepository
{
	return new PrismaArtifactCatalogueRepository(prisma);
}
