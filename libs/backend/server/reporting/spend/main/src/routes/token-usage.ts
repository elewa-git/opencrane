import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Creates router that returns token usage statistics by account.
 * @param prisma - Prisma ORM client
 * @returns Configured Express router
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
