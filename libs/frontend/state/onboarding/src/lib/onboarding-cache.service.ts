import { Inject, Injectable } from "@angular/core";

import { SESSION_STORAGE_GATEWAY, StorageGateway } from "@opencrane/state/utils/storage";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { OnboardingStep } from "./onboarding.types";
import type { OnboardingSelection } from "./onboarding.types";

/**
 * Headless state service for persisting the self-serve onboarding flow.
 * 
 * Injected into the UI feature component to preserve progress across
 * the Zitadel OIDC redirect, abstracting away the browser storage mechanism.
 */
@Injectable({ providedIn: "root" })
export class OnboardingCacheService
{
	/** Storage key for the self-serve funnel progress. */
	private readonly _STATE_KEY = "weownai.onboarding.state";

	/** Initialize with the abstract session storage gateway. */
	constructor(@Inject(SESSION_STORAGE_GATEWAY) private readonly _storage: StorageGateway)
	{
	}

	/** Save the step and selection so it survives redirects. */
	public saveState(state: { step: OnboardingStep; selection: OnboardingSelection }): void
	{
		this._storage.setItem(this._STATE_KEY, JSON.stringify(state));
	}

	/** Read and deserialize the saved state. */
	public restoreState(): { step: OnboardingStep; selection: OnboardingSelection } | null
	{
		const raw = this._storage.getItem(this._STATE_KEY);
		if (raw === null)
		{
			return null;
		}

		try
		{
			return ___ParseAndValidateJson(raw, "onboarding session state", _OnboardingState);
		}
		catch
		{
			// Ignore malformed JSON payload
			return null;
		}
	}

	/** Clear the saved state after a successful checkout. */
	public clearState(): void
	{
		this._storage.removeItem(this._STATE_KEY);
	}
}

/** Validate and rebuild the cached onboarding state instead of trusting browser storage. */
function _OnboardingState(value: unknown): { step: OnboardingStep; selection: OnboardingSelection }
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("onboarding session state must be an object");
	const state = value as Record<string, unknown>;
	if (!_IsOnboardingStep(state["step"])) throw new Error("onboarding session state contains an invalid step");
	if (typeof state["selection"] !== "object" || state["selection"] === null || Array.isArray(state["selection"])) throw new Error("onboarding session state contains an invalid selection");
	const selection = state["selection"] as Record<string, unknown>;
	if (typeof selection["planId"] !== "string" && selection["planId"] !== null) throw new Error("onboarding session state contains an invalid plan");
	if (typeof selection["account"] !== "object" || selection["account"] === null || Array.isArray(selection["account"])) throw new Error("onboarding session state contains an invalid account");
	const account = selection["account"] as Record<string, unknown>;
	if (typeof account["displayName"] !== "string" || typeof account["adminEmail"] !== "string" || typeof account["baseDomain"] !== "string" || typeof account["name"] !== "string") throw new Error("onboarding session state contains invalid account fields");
	return {
		step: state["step"],
		selection: {
			planId: selection["planId"],
			account: { displayName: account["displayName"], adminEmail: account["adminEmail"], baseDomain: account["baseDomain"], name: account["name"] },
		},
	};
}

/** Return whether one persisted numeric value is an actual onboarding step. */
function _IsOnboardingStep(value: unknown): value is OnboardingStep
{
	return value === OnboardingStep.Plan
		|| value === OnboardingStep.Account
		|| value === OnboardingStep.SignUp
		|| value === OnboardingStep.Payment
		|| value === OnboardingStep.Provision
		|| value === OnboardingStep.Status;
}
