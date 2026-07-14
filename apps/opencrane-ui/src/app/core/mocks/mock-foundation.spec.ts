import { EnvironmentInjector, Injector, createEnvironmentInjector } from "@angular/core";
import { describe, expect, it } from "vitest";

import { UiMockAccessMode, UiMockScenario } from "../models/mock-scenario.types.js";
import { UiMutationPhase, UiRole } from "../models/ui-data.types.js";
import { UI_ACCESS_GUARD, UI_FIRST_RUN_GUARD, UI_SESSION_DATA_SOURCE, UI_SETTINGS_DATA_SOURCE } from "../state/ui-data-source.tokens.js";
import { ___MockAccessGuard } from "./mock-access.guard.js";
import { MockClockService } from "./mock-clock.service.js";
import { ___MockFirstRunGuard } from "./mock-first-run.guard.js";
import { MockIdentityService } from "./mock-identity.service.js";
import { MockResetService } from "./mock-reset.service.js";
import { MockScenarioService } from "./mock-scenario.service.js";
import { MockSessionService } from "./mock-session.service.js";
import { MockSettingsService } from "./mock-settings.service.js";
import { ___ProvideUiMocks } from "./provide-ui-mocks.js";

/** Scenario-to-presentation expectations used by the deterministic matrix test. */
const SCENARIO_MATRIX =
[
	{ scenario: UiMockScenario.Default, flag: null },
	{ scenario: UiMockScenario.Empty, flag: null },
	{ scenario: UiMockScenario.Loading, flag: "loading" },
	{ scenario: UiMockScenario.Error, flag: "error" },
	{ scenario: UiMockScenario.Permission, flag: "permissionRestricted" },
	{ scenario: UiMockScenario.Limits, flag: "limitReached" },
	{ scenario: UiMockScenario.Offline, flag: "offline" },
	{ scenario: UiMockScenario.LongContent, flag: "longContent" }
] as const;

describe("G1 deterministic mock foundation", function _MockFoundationSuite(): void
{
	it("covers every content scenario with explicit presentation state", function _CoverScenarioMatrix(): void
	{
		const injector = _CreateMockInjector();
		const reset = injector.get(MockResetService);
		const scenarios = injector.get(MockScenarioService);
		const sessions = injector.get(MockSessionService);
		const settings = injector.get(MockSettingsService);

		SCENARIO_MATRIX.forEach(function _AssertScenario(entry): void
		{
			reset.selectScenario(entry.scenario);
			const presentation = scenarios.presentation();
			if (entry.flag)
			{
				expect(Boolean(presentation[entry.flag])).toBe(true);
			}
			else
			{
				expect(presentation.loading).toBe(false);
				expect(presentation.error).toBeNull();
			}
			if (entry.scenario === UiMockScenario.Empty)
			{
				expect(sessions.state().sessions).toEqual([]);
				expect(settings.channels()).toEqual([]);
			}
			if (entry.scenario === UiMockScenario.Offline)
			{
				expect(sessions.state().connected).toBe(false);
			}
		});
		injector.destroy();
	});

	it("derives identity, tenant, and role from the access mode", function _DeriveAccess(): void
	{
		const injector = _CreateMockInjector();
		const scenarios = injector.get(MockScenarioService);
		const identity = injector.get(MockIdentityService);

		scenarios.selectAccessMode(UiMockAccessMode.Member);
		expect(identity.access().identity?.role).toBe(UiRole.Member);
		expect(identity.access().tenantId).toBe("tenant-elewa");

		scenarios.selectAccessMode(UiMockAccessMode.NoTenant);
		expect(identity.access().authenticated).toBe(true);
		expect(identity.access().tenantId).toBeNull();
		injector.destroy();
	});

	it("runs Session mutations through pending, success, error, and cancellation", function _MutateSession(): void
	{
		const injector = _CreateMockInjector();
		const clock = injector.get(MockClockService);
		const scenarios = injector.get(MockScenarioService);
		const sessions = injector.get(MockSessionService);
		const initialCount = sessions.state().messages.length;

		sessions.sendMessage("Create the launch brief");
		expect(sessions.mutation().phase).toBe(UiMutationPhase.Pending);
		expect(sessions.state().messages).toHaveLength(initialCount);
		clock.advance(240);
		expect(sessions.mutation().phase).toBe(UiMutationPhase.Success);
		expect(sessions.state().messages).toHaveLength(initialCount + 2);
		const firstGeneratedIds = sessions.state().messages.slice(initialCount).map(function _Id(message): string { return message.id; });

		sessions.sendMessage("Create a second brief");
		clock.advance(240);
		const allGeneratedIds = sessions.state().messages.slice(initialCount).map(function _Id(message): string { return message.id; });
		expect(new Set(allGeneratedIds).size).toBe(4);
		expect(allGeneratedIds).not.toEqual(firstGeneratedIds);

		scenarios.selectScenario(UiMockScenario.Error);
		sessions.sendMessage("Retry");
		clock.advance(240);
		expect(sessions.mutation().phase).toBe(UiMutationPhase.Error);
		expect(sessions.state().messages).toHaveLength(initialCount + 4);

		scenarios.selectScenario(UiMockScenario.Default);
		sessions.sendMessage("Cancel this");
		sessions.cancelMutation();
		clock.advance(240);
		expect(sessions.mutation().phase).toBe(UiMutationPhase.Cancelled);
		expect(sessions.state().messages).toHaveLength(initialCount + 4);
		injector.destroy();
	});

	it("runs Settings mutations through provider-owned lifecycle state", function _MutateSettings(): void
	{
		const injector = _CreateMockInjector();
		const clock = injector.get(MockClockService);
		const scenarios = injector.get(MockScenarioService);
		const settings = injector.get(MockSettingsService);
		const changed = { ...settings.account(), displayName: "Changed after commit" };

		settings.saveAccount(changed);
		expect(settings.mutation().phase).toBe(UiMutationPhase.Pending);
		expect(settings.account().displayName).not.toBe(changed.displayName);
		clock.advance(240);
		expect(settings.mutation().phase).toBe(UiMutationPhase.Success);
		expect(settings.account().displayName).toBe(changed.displayName);

		scenarios.selectScenario(UiMockScenario.Permission);
		settings.saveAccount({ ...changed, displayName: "Must not commit" });
		clock.advance(240);
		expect(settings.mutation().phase).toBe(UiMutationPhase.Error);
		expect(settings.account().displayName).toBe(changed.displayName);
		injector.destroy();
	});

	it("resets selectors, stores, pending work, clock, and identifier sequences together", function _ResetEverything(): void
	{
		const injector = _CreateMockInjector();
		const clock = injector.get(MockClockService);
		const reset = injector.get(MockResetService);
		const scenarios = injector.get(MockScenarioService);
		const sessions = injector.get(MockSessionService);
		const settings = injector.get(MockSettingsService);

		settings.createPersonalToken("Automation");
		clock.advance(240);
		const firstId = settings.personalTokens().at(-1)?.id;
		settings.createPersonalToken("Release");
		clock.advance(240);
		expect(settings.personalTokens().at(-1)?.id).not.toBe(firstId);
		scenarios.selectScenario(UiMockScenario.Offline);
		sessions.sendMessage("This pending task must be discarded");

		reset.reset();
		expect(scenarios.scenario()).toBe(UiMockScenario.Default);
		expect(sessions.mutation().phase).toBe(UiMutationPhase.Idle);
		expect(settings.mutation().phase).toBe(UiMutationPhase.Idle);
		clock.advance(240);
		settings.createPersonalToken("Automation");
		clock.advance(240);
		expect(settings.personalTokens().at(-1)?.id).toBe(firstId);
		injector.destroy();
	});

	it("binds facades through swappable data-source and guard tokens", function _BindDataSources(): void
	{
		const injector = _CreateMockInjector();

		expect(injector.get(UI_SESSION_DATA_SOURCE)).toBe(injector.get(MockSessionService));
		expect(injector.get(UI_SETTINGS_DATA_SOURCE)).toBe(injector.get(MockSettingsService));
		expect(injector.get(UI_ACCESS_GUARD)).toBe(___MockAccessGuard);
		expect(injector.get(UI_FIRST_RUN_GUARD)).toBe(___MockFirstRunGuard);
		injector.destroy();
	});

	it("keeps one-time token values transient", function _KeepTokenTransient(): void
	{
		const injector = _CreateMockInjector();
		const clock = injector.get(MockClockService);
		const settings = injector.get(MockSettingsService);

		settings.createPersonalToken("Automation");
		clock.advance(240);
		expect(settings.personalTokens()).toHaveLength(1);
		expect(settings.revealedToken()).toContain("one_time_only");

		settings.acknowledgeTokenReveal();
		clock.advance(240);
		expect(settings.revealedToken()).toBeNull();
		injector.destroy();
	});
});

/** Creates one isolated injector containing the complete mock provider graph. */
function _CreateMockInjector(): EnvironmentInjector
{
	const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
	return createEnvironmentInjector([___ProvideUiMocks()], parent);
}
