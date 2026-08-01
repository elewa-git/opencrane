import type { PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";

/** AI-budget controller dependencies. */
interface AiBudgetLogicDeps
{
  /** Prisma ORM client. */
  prisma: PrismaClient;
}

/** Returns global monthly spend ceiling. */
export async function _GetGlobalBudget(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const item = await deps.prisma.globalBudgetSetting.findUnique({ where: { id: 1 } });

  if (!item)
  {
    res.json({ currency: "USD", ceilingAmount: 0 });
    return;
  }

  res.json({ currency: item.currency, ceilingAmount: Number(item.ceilingAmount) });
}

/** Updates the global monthly spend ceiling. */
export async function _PutGlobalBudget(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const currency = String(req.body.currency ?? "USD").toUpperCase();
  const ceilingAmount = Number(req.body.ceilingAmount ?? 0);

  await deps.prisma.globalBudgetSetting.upsert({
    where: { id: 1 },
    update: { currency, ceilingAmount },
    create: { id: 1, currency, ceilingAmount },
  });

  res.status(204).send();
}

/** Returns all per-account monthly spend ceilings. */
export async function _GetAccountBudgets(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const accounts = await deps.prisma.accountBudgetSetting.findMany({ orderBy: { userId: "asc" } });

  res.json(accounts.map(function _mapAccount(item)
  {
    return {
      userId: item.userId,
      currency: item.currency,
      ceilingAmount: Number(item.ceilingAmount),
    };
  }));
}

/** Creates or updates the budget ceiling for a specific account. */
export async function _PutAccountBudget(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const currency = String(req.body.currency ?? "USD").toUpperCase();
  const ceilingAmount = Number(req.body.ceilingAmount ?? 0);

  await deps.prisma.accountBudgetSetting.upsert({
    where: { userId },
    update: { currency, ceilingAmount },
    create: { userId, currency, ceilingAmount },
  });

  res.status(204).send();
}

/** Deletes a per-account spend ceiling. */
export async function _DeleteAccountBudget(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  await deps.prisma.accountBudgetSetting.deleteMany({ where: { userId } });
  res.status(204).send();
}
