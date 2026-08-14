import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _DeleteAccountBudget, _GetAccountBudgets, _GetGlobalBudget, _PutAccountBudget, _PutGlobalBudget } from "../core/ai-budget.logic";

/**
 * Build the spend-ceiling routes: one platform-wide ceiling, plus per-user overrides.
 *
 * Every handler lives in core/ai-budget.logic.ts; this file only maps method and path onto
 * them, so route wiring and behaviour can be reviewed separately.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/ai-budget`.
 *
 * @param prisma - Database client passed through to the handlers.
 * @returns An Express router with the five budget routes mounted on it.
 */
export function aiBudgetRouter(prisma: PrismaClient): Router
{
  const router = Router();
  const deps = {
    prisma,
  };

  /** Returns global monthly spend ceiling. */
  router.get("/global", async function _getGlobalBudget(req, res)
  {
    await _GetGlobalBudget(req, res, deps);
  });

  /** Updates the global monthly spend ceiling. */
  router.put("/global", async function _putGlobalBudget(req, res)
  {
    await _PutGlobalBudget(req, res, deps);
  });

  /** Returns all per-account monthly spend ceilings. */
  router.get("/accounts", async function _getAccountBudgets(req, res)
  {
    await _GetAccountBudgets(req, res, deps);
  });

  /** Creates or updates the budget ceiling for a specific account. */
  router.put("/accounts/:userId", async function _putAccountBudget(req, res)
  {
    await _PutAccountBudget(req, res, deps);
  });

  /** Deletes a per-account spend ceiling. */
  router.delete("/accounts/:userId", async function _deleteAccountBudget(req, res)
  {
    await _DeleteAccountBudget(req, res, deps);
  });

  return router;
}
