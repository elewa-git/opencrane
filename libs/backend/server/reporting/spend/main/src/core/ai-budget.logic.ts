import type { PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";

/** AI-budget controller dependencies. */
interface AiBudgetLogicDeps
{
  /** Prisma ORM client. */
  prisma: PrismaClient;
}

/**
 * Answer with the platform-wide monthly spend ceiling.
 *
 * There is exactly one such row (id 1). When it has never been set the response is
 * `{ currency: "USD", ceilingAmount: 0 }` rather than a 404 — so a client always gets a number,
 * and a zero ceiling means "not configured", NOT "no spending allowed".
 *
 * Called by: `aiBudgetRouter` (routes/ai-budget.ts) for `GET /global`, mounted at
 * `/api/v1/ai-budget` by apps/opencrane/src/app/routes.ts.
 *
 * @param deps - Carries the database client.
 * @returns Nothing; writes a 200 JSON body to `res`.
 */
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

/**
 * Set the platform-wide monthly spend ceiling, creating the single row if it does not exist yet.
 *
 * Inputs are coerced rather than rejected: a missing currency becomes `USD` and is upper-cased,
 * and a missing or unparseable amount becomes 0. A client sending a typo therefore gets 204 and
 * a zero ceiling, not a validation error — worth knowing before relying on this endpoint.
 *
 * Called by: `aiBudgetRouter` (routes/ai-budget.ts) for `PUT /global`.
 *
 * @returns Nothing; answers 204 with no body.
 */
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

/**
 * List every per-user monthly ceiling, ordered by user id so the response is stable between
 * calls. Users with no row of their own are simply absent — they fall back to the global
 * ceiling.
 *
 * Called by: `aiBudgetRouter` (routes/ai-budget.ts) for `GET /accounts`.
 *
 * @returns Nothing; writes a 200 JSON array to `res`.
 */
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

/**
 * Set one user's monthly ceiling, creating the row if there is none.
 *
 * Same lenient coercion as the global setter: a missing currency becomes `USD`, a missing or
 * unparseable amount becomes 0.
 *
 * Called by: `aiBudgetRouter` (routes/ai-budget.ts) for `PUT /accounts/:userId`.
 *
 * @returns Nothing; answers 204 with no body.
 */
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

/**
 * Remove one user's own ceiling, so they fall back to the global one.
 *
 * Answers 204 whether or not a row existed, so it is safe to call twice.
 *
 * Called by: `aiBudgetRouter` (routes/ai-budget.ts) for `DELETE /accounts/:userId`.
 *
 * @returns Nothing; answers 204 with no body.
 */
export async function _DeleteAccountBudget(req: Request, res: Response, deps: AiBudgetLogicDeps): Promise<void>
{
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  await deps.prisma.accountBudgetSetting.deleteMany({ where: { userId } });
  res.status(204).send();
}
