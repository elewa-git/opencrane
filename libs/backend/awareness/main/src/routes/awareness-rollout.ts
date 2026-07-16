import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { ___DEFAULT_AWARENESS_CONTRACT_VERSION, ___DEFAULT_AWARENESS_WAVES, _NextWave, _NormalizeRollout, _PromoteNextWave, _PromoteToWave, _ResolveAwarenessVersion, _Rollback } from "../core/rollout.js";
import { _LoadAwarenessRollout, _SaveAwarenessRollout } from "../core/rollout-store.js";
import type { AwarenessRolloutState } from "../core/rollout.types.js";
import type { PromoteRolloutRequest, SetRolloutRequest } from "./awareness-rollout.types.js";

/**
 * Fleet awareness contract rollout router (P4B.3).
 *
 * Manages promoting an awareness `targetVersion` across canary waves
 * (personal→project→department→org) with a one-step rollback, so the fleet
 * upgrades without downtime. CLI-first: `oc awareness rollout …` and the WeOwnAI
 * frontend are both clients of these endpoints. Mounted under
 * `/api/v1/awareness/rollout` behind `___AuthMiddleware`.
 *
 * @param prisma - Prisma client for the singleton rollout row + tenant lookups.
 * @returns Configured Express router.
 */
export function awarenessRolloutRouter(prisma: PrismaClient): Router
{
  const router = Router();

  /** Show the current rollout state + the next wave a promote would advance to. */
  router.get("/", async function _getRollout(req, res, next)
  {
    try
    {
      const state = await _LoadAwarenessRollout(prisma);
      res.json({ ...state, nextWave: _NextWave(state) });
    }
    catch (err) { next(err); }
  });

  /** Define (or redefine) the rollout; resets the promotion frontier to none. */
  router.put("/", async function _setRollout(req, res, next)
  {
    try
    {
      const body = (req.body ?? {}) as SetRolloutRequest;
      if (typeof body.targetVersion !== "string" || body.targetVersion.trim().length === 0)
      {
        res.status(400).json({ error: "targetVersion is required", code: "VALIDATION_ERROR" });
        return;
      }

      // 1. Build the candidate state (a redefine starts a fresh rollout — no
      //    waves promoted yet) and normalise/validate it before persisting.
      const candidate: AwarenessRolloutState = {
        targetVersion: body.targetVersion.trim(),
        stableVersion: (typeof body.stableVersion === "string" && body.stableVersion.trim().length > 0 ? body.stableVersion.trim() : ___DEFAULT_AWARENESS_CONTRACT_VERSION),
        waves: Array.isArray(body.waves) && body.waves.length > 0 ? body.waves.map(String) : ___DEFAULT_AWARENESS_WAVES,
        promotedWaves: [],
        shadowMode: body.shadowMode === true,
      };
      const normalized = _NormalizeRollout(candidate);

      // 2. Upsert the singleton.
      await _SaveAwarenessRollout(prisma, normalized);
      res.json({ ...normalized, nextWave: _NextWave(normalized) });
    }
    catch (err)
    {
      if (err instanceof Error && /required|unique|wave/.test(err.message))
      {
        res.status(400).json({ error: err.message, code: "VALIDATION_ERROR" });
        return;
      }
      next(err);
    }
  });

  /** Advance the rollout frontier — one wave, or up to a named wave. */
  router.post("/promote", async function _promote(req, res, next)
  {
    try
    {
      const body = (req.body ?? {}) as PromoteRolloutRequest;
      const state = await _LoadAwarenessRollout(prisma);
      const advanced = typeof body.wave === "string" && body.wave.length > 0 ? _PromoteToWave(state, body.wave) : _PromoteNextWave(state);
      await _SaveAwarenessRollout(prisma, advanced);
      res.json({ ...advanced, nextWave: _NextWave(advanced) });
    }
    catch (err)
    {
      if (err instanceof Error && err.message.startsWith("unknown wave"))
      {
        res.status(400).json({ error: err.message, code: "VALIDATION_ERROR" });
        return;
      }
      next(err);
    }
  });

  /** One-step rollback: return every wave to the stable version. */
  router.post("/rollback", async function _rollback(req, res, next)
  {
    try
    {
      const state = await _LoadAwarenessRollout(prisma);
      const rolledBack = _Rollback(state);
      await _SaveAwarenessRollout(prisma, rolledBack);
      res.json({ ...rolledBack, nextWave: _NextWave(rolledBack) });
    }
    catch (err) { next(err); }
  });

  /** Resolve the contract version a specific tenant runs under the rollout. */
  router.get("/resolve/:tenant", async function _resolve(req, res, next)
  {
    try
    {
      const tenant = await prisma.tenant.findUnique({ where: { name: req.params.tenant }, select: { name: true, awarenessWave: true } });
      if (!tenant)
      {
        res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
        return;
      }
      const state = await _LoadAwarenessRollout(prisma);
      res.json({ tenant: tenant.name, ..._ResolveAwarenessVersion(state, tenant.awarenessWave) });
    }
    catch (err) { next(err); }
  });

  return router;
}
