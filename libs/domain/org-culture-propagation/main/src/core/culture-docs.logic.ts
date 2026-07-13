import type { PrismaClient } from "@prisma/client";

import { _AssertNoL0Directives } from "./l0-guard.js";
import type { CultureDocResponse, CultureDocVersionSummary, PublishCultureDocResult } from "../routes/culture-docs.types.js";

/**
 * Publish a new immutable version of an L1 culture doc (P4C.3).
 *
 * Rejects content carrying L0 system-mechanic directives before any write, then
 * appends a new version (never mutates an existing one) and advances the doc's
 * `currentVersion`. The whole publish runs in a transaction so the version row
 * and the `currentVersion` bump can never diverge.
 *
 * @param prisma    - Prisma client.
 * @param name      - Document name (workspace file stem, e.g. `SOUL`).
 * @param content   - The new version's full content.
 * @param createdBy - Identity publishing the version (for audit).
 * @returns The doc name and the version number assigned.
 * @throws When the content carries forbidden L0 directives.
 */
export async function _PublishCultureDocVersion(prisma: PrismaClient, name: string, content: string, createdBy: string): Promise<PublishCultureDocResult>
{
  // 1. Reject L0 directives up front — a culture doc must never assert platform
  //    mechanics, and we must not persist even a rejected version.
  _AssertNoL0Directives(content);

  // 2. Atomically upsert the doc, compute the next version, and append it — the
  //    transaction keeps `currentVersion` and the version rows consistent under
  //    concurrent publishes.
  return prisma.$transaction(async function _publish(tx): Promise<PublishCultureDocResult>
  {
    const doc = await tx.cultureDoc.upsert({
      where: { name },
      create: { name, currentVersion: 0 },
      update: {},
      select: { id: true, currentVersion: true },
    });

    const nextVersion = doc.currentVersion + 1;

    await tx.cultureDocVersion.create({
      data: { cultureDocId: doc.id, version: nextVersion, content, createdBy },
    });

    await tx.cultureDoc.update({
      where: { id: doc.id },
      data: { currentVersion: nextVersion },
    });

    return { name, version: nextVersion };
  });
}

/**
 * Get a culture doc's current state and latest content (P4C.3).
 *
 * @param prisma - Prisma client.
 * @param name   - Document name.
 * @returns The doc with its current content, or null when it does not exist.
 */
export async function _GetCultureDoc(prisma: PrismaClient, name: string): Promise<CultureDocResponse | null>
{
  const doc = await prisma.cultureDoc.findUnique({ where: { name } });
  if (!doc)
  {
    return null;
  }

  // Resolve the current version's content; null when nothing is published yet.
  const current = doc.currentVersion > 0
    ? await prisma.cultureDocVersion.findUnique({
        where: { cultureDocId_version: { cultureDocId: doc.id, version: doc.currentVersion } },
        select: { content: true },
      })
    : null;

  return {
    name: doc.name,
    currentVersion: doc.currentVersion,
    content: current?.content ?? null,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * List a culture doc's published versions, newest first, without content (P4C.3).
 *
 * @param prisma - Prisma client.
 * @param name   - Document name.
 * @returns Version summaries, or null when the doc does not exist.
 */
export async function _ListCultureDocVersions(prisma: PrismaClient, name: string): Promise<CultureDocVersionSummary[] | null>
{
  const doc = await prisma.cultureDoc.findUnique({ where: { name }, select: { id: true } });
  if (!doc)
  {
    return null;
  }

  const versions = await prisma.cultureDocVersion.findMany({
    where: { cultureDocId: doc.id },
    orderBy: { version: "desc" },
    select: { version: true, createdBy: true, createdAt: true },
  });

  return versions.map(function _toSummary(v): CultureDocVersionSummary
  {
    return { version: v.version, createdBy: v.createdBy, createdAt: v.createdAt.toISOString() };
  });
}

/**
 * Retrieve a specific immutable culture-doc version by number (P4C.3).
 *
 * @param prisma  - Prisma client.
 * @param name    - Document name.
 * @param version - The version number to fetch.
 * @returns The version content + metadata, or null when not found.
 */
export async function _GetCultureDocVersion(prisma: PrismaClient, name: string, version: number): Promise<{ version: number; content: string; createdBy: string; createdAt: string } | null>
{
  const doc = await prisma.cultureDoc.findUnique({ where: { name }, select: { id: true } });
  if (!doc)
  {
    return null;
  }

  const row = await prisma.cultureDocVersion.findUnique({
    where: { cultureDocId_version: { cultureDocId: doc.id, version } },
    select: { version: true, content: true, createdBy: true, createdAt: true },
  });
  if (!row)
  {
    return null;
  }

  return { version: row.version, content: row.content, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() };
}
