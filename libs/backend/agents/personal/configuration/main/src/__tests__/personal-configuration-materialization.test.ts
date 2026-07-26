import { describe, expect, it } from "vitest";

import { __MaterializePersonalConfigurationChange } from "../personal-configuration-materialization.js";

/** Exercises the narrow command guard before a materialization transaction is requested. */
describe("__MaterializePersonalConfigurationChange", function _describeMaterialization()
{
	it("refuses malformed owner input before it reaches persistence", async function _refusesMalformedInput()
	{
		const repository = { materializeAtomically: async function _materialize() { return { status: "applied", agentRevisionId: "unexpected" } as const; } };
		const result = await __MaterializePersonalConfigurationChange(repository, { siloId: "silo-1", userId: "", changeId: "change-1", materializedAt: "2026-07-26T12:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it("preserves a successful future-revision application", async function _preservesApplied()
	{
		const repository = { materializeAtomically: async function _materialize() { return { status: "applied", agentRevisionId: "revision-2" } as const; } };
		const result = await __MaterializePersonalConfigurationChange(repository, { siloId: "silo-1", userId: "user-1", changeId: "change-1", materializedAt: "2026-07-26T12:00:00.000Z" });

		expect(result).toEqual({ outcome: "applied", agentRevisionId: "revision-2" });
	});
});
