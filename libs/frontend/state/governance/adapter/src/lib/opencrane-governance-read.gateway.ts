import { Injectable, inject } from "@angular/core";
import type { z } from "zod";

import { ControlPlaneApiService } from "@opencrane/core";
import { ___GovernanceAccountBudgetsSchema, ___GovernanceAuditPageSchema, ___GovernanceBudgetSchema, ___GovernanceTokenUsageRowsSchema, GovernanceReadError, GovernanceReadErrorKinds, type GovernanceAccountBudgets, type GovernanceAuditPage, type GovernanceAuditQuery, type GovernanceBudget, type GovernanceReadGateway, type GovernanceTokenUsageRows } from "@opencrane/state/governance";

import type { GovernanceReadResponse } from "./governance-read-response.types";

/** Reads the existing reporting endpoints through the signed-in generated client; never writes. */
@Injectable()
export class OpenCraneGovernanceReadGateway implements GovernanceReadGateway
{
	/** Shared client supplies the versioned origin, session cookie and sign-in redirect. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async readAuditPage(query: GovernanceAuditQuery, signal?: AbortSignal): Promise<GovernanceAuditPage>
	{
		_assertNotAborted(signal);
		return this._Read(this._api.client.GET("/audit", { params: { query }, signal }), ___GovernanceAuditPageSchema, signal);
	}

	/** @inheritdoc */
	public async readTokenUsage(signal?: AbortSignal): Promise<GovernanceTokenUsageRows>
	{
		_assertNotAborted(signal);
		return this._Read(this._api.client.GET("/token-usage", { signal }), ___GovernanceTokenUsageRowsSchema, signal);
	}

	/** @inheritdoc */
	public async readGlobalBudget(signal?: AbortSignal): Promise<GovernanceBudget>
	{
		_assertNotAborted(signal);
		return this._Read(this._api.client.GET("/ai-budget/global", { signal }), ___GovernanceBudgetSchema, signal);
	}

	/** @inheritdoc */
	public async readAccountBudgets(signal?: AbortSignal): Promise<GovernanceAccountBudgets>
	{
		_assertNotAborted(signal);
		return this._Read(this._api.client.GET("/ai-budget/accounts", { signal }), ___GovernanceAccountBudgetsSchema, signal);
	}

	/** Checks transport status and body, then prevents an aborted read from publishing its result. */
	private async _Read<Value>(request: Promise<GovernanceReadResponse>, schema: z.ZodType<Value>, signal?: AbortSignal): Promise<Value>
	{
		try
		{
			const result = await request;
			_assertNotAborted(signal);
			if (result.response.status !== 200)
				throw _statusError(result.response.status);
			const parsed = schema.safeParse(result.data);
			if (!parsed.success)
				throw new GovernanceReadError(GovernanceReadErrorKinds.InvalidResponse);
			return parsed.data;
		}
		catch (error)
		{
			_assertNotAborted(signal);
			if (error instanceof GovernanceReadError)
				throw error;
			const kind = error instanceof SyntaxError ? GovernanceReadErrorKinds.InvalidResponse : GovernanceReadErrorKinds.Unavailable;
			throw new GovernanceReadError(kind);
		}
	}
}

/** Gives stores a safe cancellation signal even when the transport ignores an abort. */
function _assertNotAborted(signal?: AbortSignal): void
{
	if (signal?.aborted)
		throw new DOMException("Governance read cancelled.", "AbortError");
}

/** Interprets status without trusting arbitrary server or upstream error prose. */
function _statusError(status: number): GovernanceReadError
{
	if (status === 401)
		return new GovernanceReadError(GovernanceReadErrorKinds.Unauthenticated);
	if (status === 403)
		return new GovernanceReadError(GovernanceReadErrorKinds.AccessDenied);
	if (status === 400 || (status >= 200 && status < 300))
		return new GovernanceReadError(GovernanceReadErrorKinds.InvalidResponse);
	return new GovernanceReadError(GovernanceReadErrorKinds.Unavailable);
}
