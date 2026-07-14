import { Signal } from "@angular/core";

import { UiAccountSettings, UiAwarenessSettings, UiBudgetSettings, UiChannel, UiDataset, UiMember, UiOrganizationUnit, UiPersonalAccessToken, UiPodSettings, UiProviderCredential, UiSkill } from "../models/settings.types.js";
import { UiDataPresentationState, UiMutationState } from "../models/ui-data.types.js";

/** Provider-neutral Settings state and actions consumed by the UI facade. */
export interface UiSettingsDataSource
{
	/** Provider-neutral loading, error, permission, limit, offline, and overflow flags. */
	readonly presentation: Signal<UiDataPresentationState>;

	/** Lifecycle of the most recent Settings mutation. */
	readonly mutation: Signal<UiMutationState>;

	/** Read-only Pod settings. */
	readonly pod: Signal<UiPodSettings>;

	/** Read-only Personal Account settings. */
	readonly account: Signal<UiAccountSettings>;

	/** Read-only Personal Awareness settings. */
	readonly awareness: Signal<UiAwarenessSettings>;

	/** Read-only organization members. */
	readonly members: Signal<readonly UiMember[]>;

	/** Read-only departments, teams, and projects. */
	readonly organizationUnits: Signal<readonly UiOrganizationUnit[]>;

	/** Read-only organization budget. */
	readonly budget: Signal<UiBudgetSettings>;

	/** Read-only installed and marketplace skills. */
	readonly skills: Signal<readonly UiSkill[]>;

	/** Read-only channel rows. */
	readonly channels: Signal<readonly UiChannel[]>;

	/** Read-only dataset rows. */
	readonly datasets: Signal<readonly UiDataset[]>;

	/** Read-only egress-domain rows. */
	readonly egressDomains: Signal<readonly string[]>;

	/** Read-only safe provider credential metadata. */
	readonly providerCredentials: Signal<readonly UiProviderCredential[]>;

	/** Read-only safe personal access-token metadata. */
	readonly personalTokens: Signal<readonly UiPersonalAccessToken[]>;

	/** Read-only transient one-time token reveal. */
	readonly revealedToken: Signal<string | null>;

	/** Saves Pod settings through the selected provider. */
	savePod(value: UiPodSettings): void;

	/** Saves Personal Account settings through the selected provider. */
	saveAccount(value: UiAccountSettings): void;

	/** Saves Personal Awareness settings through the selected provider. */
	saveAwareness(value: UiAwarenessSettings): void;

	/** Creates or updates one organization unit. */
	saveOrganizationUnit(value: UiOrganizationUnit): void;

	/** Saves organization budget settings. */
	saveBudget(value: UiBudgetSettings): void;

	/** Updates the installed or enabled state of one skill. */
	updateSkill(skillId: string, changes: Partial<Pick<UiSkill, "installed" | "enabled">>): void;

	/** Creates or updates one channel. */
	saveChannel(value: UiChannel): void;

	/** Adds one normalized network egress domain. */
	addEgressDomain(domain: string): void;

	/** Creates a personal access token and transient reveal value. */
	createPersonalToken(name: string): void;

	/** Clears a personal token's transient reveal value. */
	acknowledgeTokenReveal(): void;

	/** Revokes one personal access token. */
	revokePersonalToken(tokenId: string): void;

	/** Cancels a pending Settings mutation before it commits. */
	cancelMutation(): void;
}
