import { Injectable, inject, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiAccountSettings, UiAwarenessSettings, UiBudgetSettings, UiChannel, UiOrganizationUnit, UiPodSettings, UiSkill } from "../models/settings.types.js";
import { UiMutationPhase, UiMutationState } from "../models/ui-data.types.js";
import { UiSettingsDataSource } from "../state/settings-data-source.types.js";
import { _DefaultAccountSettings, _DefaultAwarenessSettings, _DefaultPodSettings } from "./fixtures/settings.fixtures.js";
import { MockBudgetService } from "./mock-budget.service.js";
import { MockChannelService } from "./mock-channel.service.js";
import { MockClockService } from "./mock-clock.service.js";
import { MockCredentialService } from "./mock-credential.service.js";
import { MockDataNetworkService } from "./mock-data-network.service.js";
import { MockOrganizationService } from "./mock-organization.service.js";
import { MockMutationCommit } from "./mock-mutation.types.js";
import { MockScenarioService } from "./mock-scenario.service.js";
import { MockSkillService } from "./mock-skill.service.js";

/** Owns deterministic Pod, Account, and Awareness settings. */
@Injectable()
export class MockSettingsService implements UiSettingsDataSource
{
	/** Deterministic delay applied to every mock Settings mutation. */
	private static readonly MUTATION_DELAY_MS = 240;

	/** Scenario owner controlling deterministic list and presentation variants. */
	private readonly _scenarios = inject(MockScenarioService);

	/** Deterministic scheduler used for every Settings mutation. */
	private readonly _clock = inject(MockClockService);

	/** Deterministic member and organization-unit owner. */
	private readonly _organization = inject(MockOrganizationService);

	/** Deterministic budget owner. */
	private readonly _budgets = inject(MockBudgetService);

	/** Deterministic skill owner. */
	private readonly _skills = inject(MockSkillService);

	/** Deterministic channel owner. */
	private readonly _channels = inject(MockChannelService);

	/** Deterministic dataset and egress-domain owner. */
	private readonly _dataNetwork = inject(MockDataNetworkService);

	/** Deterministic provider and personal credential owner. */
	private readonly _credentials = inject(MockCredentialService);

	/** Mutable Pod settings. */
	private readonly _pod = signal<UiPodSettings>(_DefaultPodSettings());

	/** Mutable Account settings. */
	private readonly _account = signal<UiAccountSettings>(_DefaultAccountSettings());

	/** Mutable Awareness settings. */
	private readonly _awareness = signal<UiAwarenessSettings>(_DefaultAwarenessSettings());

	/** Mutable lifecycle of the most recent Settings mutation. */
	private readonly _mutation = signal<UiMutationState>(_IdleMutation());

	/** Pending clock task identifier, or null when no mutation is queued. */
	private _pendingTaskId: number | null = null;

	/** Read-only Pod settings. */
	public readonly pod = this._pod.asReadonly();

	/** Read-only Account settings. */
	public readonly account = this._account.asReadonly();

	/** Read-only Awareness settings. */
	public readonly awareness = this._awareness.asReadonly();

	/** Read-only organization members. */
	public readonly members = this._organization.members;

	/** Read-only departments, teams, and projects. */
	public readonly organizationUnits = this._organization.units;

	/** Read-only organization budget. */
	public readonly budget = this._budgets.budget;

	/** Read-only installed and marketplace skills. */
	public readonly skills = this._skills.skills;

	/** Read-only channel rows. */
	public readonly channels = this._channels.channels;

	/** Read-only dataset rows. */
	public readonly datasets = this._dataNetwork.datasets;

	/** Read-only egress-domain rows. */
	public readonly egressDomains = this._dataNetwork.egressDomains;

	/** Read-only safe provider credential metadata. */
	public readonly providerCredentials = this._credentials.providers;

	/** Read-only safe personal access-token metadata. */
	public readonly personalTokens = this._credentials.tokens;

	/** Read-only transient one-time token reveal. */
	public readonly revealedToken = this._credentials.revealedToken;

	/** Provider-neutral presentation flags exposed to the facade. */
	public readonly presentation = this._scenarios.presentation;

	/** Read-only lifecycle of the most recent Settings mutation. */
	public readonly mutation = this._mutation.asReadonly();

	/** Initializes every Settings owner from the URL-selected scenario. */
	public constructor()
	{
		this.reset(this._scenarios.scenario());
	}

	/** Replaces Pod settings after a mock Save action. */
	public savePod(value: UiPodSettings): void
	{
		this._ScheduleMutation("save-pod", function _SavePod(this: MockSettingsService): void
		{
			this._pod.set({ ...value });
		}.bind(this));
	}

	/** Replaces Account settings after a mock Save action. */
	public saveAccount(value: UiAccountSettings): void
	{
		this._ScheduleMutation("save-account", function _SaveAccount(this: MockSettingsService): void
		{
			this._account.set({ ...value });
		}.bind(this));
	}

	/** Replaces Awareness settings after a mock Save action. */
	public saveAwareness(value: UiAwarenessSettings): void
	{
		this._ScheduleMutation("save-awareness", function _SaveAwareness(this: MockSettingsService): void
		{
			this._awareness.set({ ...value, scopeOrder: [...value.scopeOrder] });
		}.bind(this));
	}

	/** Creates or updates one deterministic organization unit. */
	public saveOrganizationUnit(value: UiOrganizationUnit): void
	{
		this._ScheduleMutation("save-organization-unit", function _SaveOrganizationUnit(this: MockSettingsService): void
		{
			this._organization.saveUnit(value);
		}.bind(this));
	}

	/** Saves deterministic organization budget settings. */
	public saveBudget(value: UiBudgetSettings): void
	{
		this._ScheduleMutation("save-budget", function _SaveBudget(this: MockSettingsService): void
		{
			this._budgets.save(value);
		}.bind(this));
	}

	/** Updates the deterministic state of one installed or marketplace skill. */
	public updateSkill(skillId: string, changes: Partial<Pick<UiSkill, "installed" | "enabled">>): void
	{
		this._ScheduleMutation("update-skill", function _UpdateSkill(this: MockSettingsService): void
		{
			this._skills.update(skillId, changes);
		}.bind(this));
	}

	/** Creates or updates one deterministic channel. */
	public saveChannel(value: UiChannel): void
	{
		this._ScheduleMutation("save-channel", function _SaveChannel(this: MockSettingsService): void
		{
			this._channels.save(value);
		}.bind(this));
	}

	/** Adds one normalized deterministic egress domain. */
	public addEgressDomain(domain: string): void
	{
		this._ScheduleMutation("add-egress-domain", function _AddEgressDomain(this: MockSettingsService): void
		{
			this._dataNetwork.addDomain(domain);
		}.bind(this));
	}

	/** Creates deterministic token metadata and a transient reveal value. */
	public createPersonalToken(name: string): void
	{
		if (!name.trim())
		{
			this._mutation.set({ phase: UiMutationPhase.Error, operation: "create-personal-token", error: "Enter a token name before creating it." });
			return;
		}
		this._ScheduleMutation("create-personal-token", function _CreatePersonalToken(this: MockSettingsService): void
		{
			this._credentials.createToken(name);
		}.bind(this));
	}

	/** Clears the transient personal token reveal value. */
	public acknowledgeTokenReveal(): void
	{
		this._ScheduleMutation("acknowledge-token-reveal", function _AcknowledgeTokenReveal(this: MockSettingsService): void
		{
			this._credentials.acknowledgeReveal();
		}.bind(this));
	}

	/** Revokes one deterministic personal token. */
	public revokePersonalToken(tokenId: string): void
	{
		this._ScheduleMutation("revoke-personal-token", function _RevokePersonalToken(this: MockSettingsService): void
		{
			this._credentials.revokeToken(tokenId);
		}.bind(this));
	}

	/** Cancels a pending Settings mutation before it changes an owned store. */
	public cancelMutation(): void
	{
		if (this._pendingTaskId === null)
		{
			return;
		}
		this._clock.cancel(this._pendingTaskId);
		const operation = this._mutation().operation;
		this._pendingTaskId = null;
		this._mutation.set({ phase: UiMutationPhase.Cancelled, operation, error: null });
	}

	/** Restores deterministic settings fixtures. */
	public reset(scenario: UiMockScenario = this._scenarios.scenario()): void
	{
		if (this._pendingTaskId !== null)
		{
			this._clock.cancel(this._pendingTaskId);
			this._pendingTaskId = null;
		}
		this._mutation.set(_IdleMutation());

		// 1. Core forms — restore the three direct settings fixtures first.
		const pod = _DefaultPodSettings();
		const account = _DefaultAccountSettings();
		this._pod.set(scenario === UiMockScenario.LongContent ? { ...pod, displayName: "Elewa cross-functional research, product, operations, and delivery workspace" } : pod);
		this._account.set(scenario === UiMockScenario.LongContent ? { ...account, displayName: "Amara Okafor — Product strategy and cross-functional delivery" } : account);
		this._awareness.set(_DefaultAwarenessSettings());

		// 2. Organization settings — restore people and budget presentation state.
		this._organization.reset(scenario);
		this._budgets.reset(scenario);

		// 3. Integrations — restore skills, channels, network, and credential metadata.
		this._skills.reset(scenario);
		this._channels.reset(scenario);
		this._dataNetwork.reset(scenario);
		this._credentials.reset(scenario);
	}

	/** Queues one store change and exposes its deterministic lifecycle. */
	private _ScheduleMutation(operation: string, commit: MockMutationCommit): void
	{
		this.cancelMutation();
		this._mutation.set({ phase: UiMutationPhase.Pending, operation, error: null });
		this._pendingTaskId = this._clock.schedule(function _CompleteMutation(this: MockSettingsService): void
		{
			this._pendingTaskId = null;
			const error = this._MutationError(operation);
			if (error)
			{
				this._mutation.set({ phase: UiMutationPhase.Error, operation, error });
				return;
			}
			commit();
			this._mutation.set({ phase: UiMutationPhase.Success, operation, error: null });
		}.bind(this), MockSettingsService.MUTATION_DELAY_MS);
	}

	/** Maps the active scenario and operation to a recoverable mutation error. */
	private _MutationError(operation: string): string | null
	{
		const scenario = this._scenarios.scenario();
		if (scenario === UiMockScenario.Error)
		{
			return "The mock Settings provider could not save this change.";
		}
		if (scenario === UiMockScenario.Permission)
		{
			return "You do not have permission to change this setting.";
		}
		if (scenario === UiMockScenario.Offline)
		{
			return "Reconnect before changing this setting.";
		}
		if (scenario === UiMockScenario.Limits && (operation === "create-personal-token" || operation === "add-egress-domain"))
		{
			return "This setting has reached its current capacity limit.";
		}
		return null;
	}
}

/** Creates a fresh idle mutation state for initialization and reset. */
function _IdleMutation(): UiMutationState
{
	return { phase: UiMutationPhase.Idle, operation: null, error: null };
}
