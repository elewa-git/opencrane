import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Build the token-usage route: recorded usage per user, newest sample first, with each user's
 * effective ceiling resolved for them — their own if they have one, otherwise the global one.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/token-usage`.
 *
 * @param prisma - Database client used to read usage samples and both kinds of budget row.
 * @returns An Express router carrying the usage route.
 */
export function tokenUsageRouter(prisma: PrismaClient): Router
{
  const router = Router();

  /** Lists per-account token usage including resolved ceiling values. */
  router.get("/", async function _listTokenUsage(req, res)
  {
    const usage = await prisma.tokenUsageSnapshot.findMany({ orderBy: { sampledAt: "desc" } });
    const globalBudget = await prisma.globalBudgetSetting.findUnique({ where: { id: 1 } });

    const accountBudgets = await prisma.accountBudgetSetting.findMany();
    const budgetByUser = new Map(accountBudgets.map(function _mapBudget(item)
    {
      return [item.userId, item];
    }));

    res.json(usage.map(function _mapUsage(item)
    {
      const accountBudget = budgetByUser.get(item.userId);
      const hasGlobalBudget = Boolean(globalBudget) && globalBudget?.currency === item.currency;
      const budgetCeiling = accountBudget && accountBudget.currency === item.currency
        ? Number(accountBudget.ceilingAmount)
        : hasGlobalBudget
          ? Number(globalBudget?.ceilingAmount ?? 0)
          : undefined;

      return {
        userId: item.userId,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        totalTokens: item.totalTokens,
        currency: item.currency,
        totalCost: Number(item.totalCost),
        budgetCeiling,
      };
    }));
  });

  return router;
}
