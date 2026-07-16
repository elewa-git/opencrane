import type { PrismaClient } from "@prisma/client";

import { ___DEFAULT_AWARENESS_CONTRACT_VERSION, ___DEFAULT_AWARENESS_WAVES } from "./rollout.js";
import type { AwarenessRolloutState } from "./rollout.types.js";

/** Singleton row id for the fleet awareness rollout. */
const _ROLLOUT_ID = "default";

/**
 * Load the singleton awareness rollout, returning a sensible default — every
 * wave on the SDK's pinned version, nothing promoted — when none is defined yet.
 *
 * @param prisma - Prisma client.
 * @returns The current rollout state.
 */
export async function _LoadAwarenessRollout(prisma: PrismaClient): Promise<AwarenessRolloutState>
{
  const row = await prisma.awarenessRollout.findUnique({ where: { id: _ROLLOUT_ID } });
  if (!row)
  {
    return { targetVersion: ___DEFAULT_AWARENESS_CONTRACT_VERSION, stableVersion: ___DEFAULT_AWARENESS_CONTRACT_VERSION, waves: ___DEFAULT_AWARENESS_WAVES, promotedWaves: [], shadowMode: false };
  }
  return {
    targetVersion: row.targetVersion,
    stableVersion: row.stableVersion,
    waves: _toStringArray(row.waves),
    promotedWaves: _toStringArray(row.promotedWaves),
    shadowMode: row.shadowMode,
  };
}

/**
 * Upsert the singleton awareness rollout row.
 *
 * @param prisma - Prisma client.
 * @param state  - The state to persist.
 */
export async function _SaveAwarenessRollout(prisma: PrismaClient, state: AwarenessRolloutState): Promise<void>
{
  const data = {
    targetVersion: state.targetVersion,
    stableVersion: state.stableVersion,
    waves: state.waves,
    promotedWaves: state.promotedWaves,
    shadowMode: state.shadowMode,
  };
  await prisma.awarenessRollout.upsert({ where: { id: _ROLLOUT_ID }, create: { id: _ROLLOUT_ID, ...data }, update: data });
}

/**
 * Coerce a Prisma JSON column to a string array, tolerating malformed values.
 * @param value - The raw JSON value.
 */
function _toStringArray(value: unknown): string[]
{
  return Array.isArray(value) ? value.filter(function _isStr(v): v is string { return typeof v === "string"; }) : [];
}
