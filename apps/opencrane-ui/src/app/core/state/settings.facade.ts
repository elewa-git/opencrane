import { Injectable, inject } from "@angular/core";

import { UiAccountSettings, UiAwarenessSettings, UiBudgetSettings, UiChannel, UiOrganizationUnit, UiPodSettings, UiSkill } from "../models/settings.types.js";
import { UI_SETTINGS_DATA_SOURCE } from "./ui-data-source.tokens.js";

/** Stable orchestration seam consumed by every Settings feature route. */
@Injectable({ providedIn: "root" })
export class SettingsFacade
{
	/** Provider-neutral Settings state owner selected by dependency injection. */
	private readonly _source = inject(UI_SETTINGS_DATA_SOURCE);

	/** Provider-neutral presentation state for loading, failure, permission, and stress variants. */
	public readonly presentation = this._source.presentation;

	/** Lifecycle of the most recent Settings mutation. */
	public readonly mutation = this._source.mutation;

	/** Read-only Pod settings. */
	public readonly pod = this._source.pod;

	/** Read-only Personal Account settings. */
	public readonly account = this._source.account;

	/** Read-only Personal Awareness settings. */
	public readonly awareness = this._source.awareness;

	/** Read-only organization members. */
	public readonly members = this._source.members;

	/** Read-only departments, teams, and projects. */
	public readonly organizationUnits = this._source.organizationUnits;

	/** Read-only organization budget. */
	public readonly budget = this._source.budget;

	/** Read-only installed and marketplace skills. */
	public readonly skills = this._source.skills;

	/** Read-only channel rows. */
	public readonly channels = this._source.channels;

	/** Read-only dataset rows. */
	public readonly datasets = this._source.datasets;

	/** Read-only egress-domain rows. */
	public readonly egressDomains = this._source.egressDomains;

	/** Read-only safe provider credential metadata. */
	public readonly providerCredentials = this._source.providerCredentials;

	/** Read-only safe personal token metadata. */
	public readonly personalTokens = this._source.personalTokens;

	/** Read-only transient one-time token reveal. */
	public readonly revealedToken = this._source.revealedToken;

	/** Saves Pod settings through the selected provider. */
	public savePod(value: UiPodSettings): void
	{
		this._source.savePod(value);
	}

	/** Saves Personal Account settings through the selected provider. */
	public saveAccount(value: UiAccountSettings): void
	{
		this._source.saveAccount(value);
	}

	/** Saves Personal Awareness settings through the selected provider. */
	public saveAwareness(value: UiAwarenessSettings): void
	{
		this._source.saveAwareness(value);
	}

	/** Creates or updates one organization unit. */
	public saveOrganizationUnit(value: UiOrganizationUnit): void
	{
		this._source.saveOrganizationUnit(value);
	}

	/** Saves organization budget settings. */
	public saveBudget(value: UiBudgetSettings): void
	{
		this._source.saveBudget(value);
	}

	/** Updates the installed or enabled state of one skill. */
	public updateSkill(skillId: string, changes: Partial<Pick<UiSkill, "installed" | "enabled">>): void
	{
		this._source.updateSkill(skillId, changes);
	}

	/** Creates or updates one channel. */
	public saveChannel(value: UiChannel): void
	{
		this._source.saveChannel(value);
	}

	/** Adds one normalized network egress domain. */
	public addEgressDomain(domain: string): void
	{
		this._source.addEgressDomain(domain);
	}

	/** Creates a personal access token and transient reveal value. */
	public createPersonalToken(name: string): void
	{
		this._source.createPersonalToken(name);
	}

	/** Clears a personal token's transient reveal value. */
	public acknowledgeTokenReveal(): void
	{
		this._source.acknowledgeTokenReveal();
	}

	/** Revokes one personal access token. */
	public revokePersonalToken(tokenId: string): void
	{
		this._source.revokePersonalToken(tokenId);
	}

	/** Cancels a pending Settings mutation before it commits. */
	public cancelMutation(): void
	{
		this._source.cancelMutation();
	}
}
