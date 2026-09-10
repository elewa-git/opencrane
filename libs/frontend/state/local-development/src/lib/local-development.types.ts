import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

/**
 * Selects one finite, process-local transport or run projection from the browser `mockScenario`
 * query parameter. These values are fixture coordinates rather than persisted product state; adding
 * one requires matching owner tests and developer-guide documentation.
 *
 * Called by: the Tier 1 provider factory and its local gateway owner.
 *
 * @see ../../../../../../website/contributing/local-development.md
 */
export enum LocalDevelopmentScenarios
{
	/** Returns successful reads and a live conversation stream. */
	HappyPath = "happy-path",
	/** Delays the first live conversation update by a short fixed interval. */
	Slow = "slow",
	/** Fails one recoverable command attempt before the exact retry succeeds. */
	Retry = "retry",
	/** Keeps the accepted history while reporting an active reconnect. */
	Reconnecting = "reconnecting",
	/** Returns a terminal failed personal run without fabricating assistant output. */
	FailedRun = "failed-run",
	/** Revokes the selected conversation and returns an empty history projection. */
	AccessChanged = "access-changed"
}

/**
 * Selects the deterministic fixture composed by one Tier 1 browser process. The plain command keeps
 * onboarding authoritative while a named command starts from its reviewed archetype; no selection or
 * gateway state survives a browser reload.
 *
 * Called by: `provideLocalDevelopmentGateways` and `_CreateLocalDevelopmentOwner`.
 *
 * @see LocalDevelopmentScenarios
 * @see ../../../../../../website/contributing/local-development.md
 */
export interface LocalDevelopmentConfig
{
	/** Selects the reviewed archetype used after the optional onboarding survey. */
	readonly archetype?: PersonaFirstChatArchetypes;
	/** Keeps the plain command at the survey while Commander supplies only its initial fixture. */
	readonly startWithOnboarding?: boolean;
	/** Selects one deterministic failure or recovery state; omission uses the happy path. */
	readonly scenario?: LocalDevelopmentScenarios;
}
