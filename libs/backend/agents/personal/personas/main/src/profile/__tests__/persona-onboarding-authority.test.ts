import { describe, expect, it, vi } from "vitest";

import { __EnsurePersonaOnboarding } from "../persona-onboarding-authority.js";
import type { EnsurePersonaOnboardingCommand, PersonaOnboardingRepository } from "../persona-onboarding-authority.types.js";

/** Builds a complete authenticated owner request for the onboarding provisioner. */
function _command(): EnsurePersonaOnboardingCommand
{
	return { siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" };
}

/** Builds a repository whose call surface is observable without a database. */
function _repository(ensureAtomically: PersonaOnboardingRepository["ensureAtomically"]): PersonaOnboardingRepository
{
	return { ensureAtomically };
}

describe("__EnsurePersonaOnboarding", function _describe()
{
	it("rejects missing authenticated ownership coordinates before persistence", async function _rejectsInvalidCommand()
	{
		const ensureAtomically = vi.fn();
		const result = await __EnsurePersonaOnboarding(_repository(ensureAtomically), { ..._command(), userId: " " });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(ensureAtomically).not.toHaveBeenCalled();
	});

	it("delegates a complete authenticated owner request", async function _delegates()
	{
		const ensureAtomically = vi.fn().mockResolvedValue({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 } });
		await expect(__EnsurePersonaOnboarding(_repository(ensureAtomically), _command())).resolves.toEqual({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 } });
		expect(ensureAtomically).toHaveBeenCalledWith(_command());
	});
});
