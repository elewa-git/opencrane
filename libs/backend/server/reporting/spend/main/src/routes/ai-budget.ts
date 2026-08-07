import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _DeleteAccountBudget, _GetAccountBudgets, _GetGlobalBudget, _PutAccountBudget, _PutGlobalBudget } from "../core/ai-budget.logic.js";

/**
 * Router for AI spend control and budget management.
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
