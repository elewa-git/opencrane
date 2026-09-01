import { Router, type Request, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaSpendUnitOfWork, SpendAuthorizationError } from "../prisma-spend-authority";
import type { BudgetSettingWrite, SpendAuthorizationAuthorityFactory, SpendRouteCaller, SpendRouteCallerResolver } from "../spend.types";

/** Resolves spend authority from the verified browser Principal. */
function _ResolveSpendCaller(request: Request): SpendRouteCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
}

/** Returns the trusted caller or sends the fail-closed authorization response. */
function _RequireSpendCaller(request: Request, response: Response, resolveCaller: SpendRouteCallerResolver): SpendRouteCaller | null
{
	const caller = resolveCaller(request);
	if (caller !== null)
	{
		return caller;
	}
	response.status(403).json({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
	return null;
}

/** Maps a central spend-authorization denial to the public forbidden response. */
function _SendSpendAuthorizationError(error: unknown, response: Response): boolean
{
	if (!(error instanceof SpendAuthorizationError))
	{
		return false;
	}
	response.status(403).json({ error: error.message, code: "FORBIDDEN" });
	return true;
}

/**
 * Builds silo-scoped spend-ceiling routes for one organization ceiling and account overrides.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/ai-budget`.
 *
 * @param prisma - Database client passed through to the handlers.
 * @returns An Express router with the five budget routes mounted on it.
 */
export function aiBudgetRouter(prisma: PrismaClient, resolveCaller: SpendRouteCallerResolver = _ResolveSpendCaller, createAuthorization?: SpendAuthorizationAuthorityFactory<Prisma.TransactionClient>): Router
{
	const router = Router();
	const spend = new PrismaSpendUnitOfWork(prisma, createAuthorization);

  /** Returns global monthly spend ceiling. */
	router.get("/global", async function _GetGlobalBudget(request, response)
	{
		const caller = _RequireSpendCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.json(await spend.getGlobalBudget(caller));
		}
		catch (error)
		{
			if (!_SendSpendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

  /** Updates the global monthly spend ceiling. */
	router.put("/global", async function _PutGlobalBudget(request, response)
	{
		const caller = _RequireSpendCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		const setting: BudgetSettingWrite = { currency: String(request.body.currency ?? "USD").toUpperCase(), ceilingAmount: Number(request.body.ceilingAmount ?? 0) };
		try
		{
			await spend.putGlobalBudget(caller, setting);
			response.status(204).send();
		}
		catch (error)
		{
			if (!_SendSpendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

  /** Returns all per-account monthly spend ceilings. */
	router.get("/accounts", async function _GetAccountBudgets(request, response)
	{
		const caller = _RequireSpendCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		try
		{
			response.json(await spend.listAccountBudgets(caller));
		}
		catch (error)
		{
			if (!_SendSpendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

  /** Creates or updates the budget ceiling for a specific account. */
	router.put("/accounts/:userId", async function _PutAccountBudget(request, response)
	{
		const caller = _RequireSpendCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		const userId = Array.isArray(request.params.userId) ? request.params.userId[0] : request.params.userId;
		const setting: BudgetSettingWrite = { currency: String(request.body.currency ?? "USD").toUpperCase(), ceilingAmount: Number(request.body.ceilingAmount ?? 0) };
		try
		{
			await spend.putAccountBudget(caller, userId, setting);
			response.status(204).send();
		}
		catch (error)
		{
			if (!_SendSpendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

  /** Deletes a per-account spend ceiling. */
	router.delete("/accounts/:userId", async function _DeleteAccountBudget(request, response)
	{
		const caller = _RequireSpendCaller(request, response, resolveCaller);
		if (caller === null)
		{
			return;
		}
		const userId = Array.isArray(request.params.userId) ? request.params.userId[0] : request.params.userId;
		try
		{
			await spend.deleteAccountBudget(caller, userId);
			response.status(204).send();
		}
		catch (error)
		{
			if (!_SendSpendAuthorizationError(error, response))
			{
				throw error;
			}
		}
	});

	return router;
}
