import { describe, expect, it } from "vitest";

import { ___IsDurableStatePolicy, ___IsPlatformPolicy, ___IsRuntimeFilesystemPolicy, ___IsSiloUpdateDurationAllowed, ___IsSiloUpdatePolicy, ___MAXIMUM_SILO_UPDATE_DURATION_MS, ___PLATFORM_POLICY } from "../platform-policy.js";

describe("platform policy", function _suite()
{
	it("retains canonical state until authorized deletion on expandable persistent storage", function _checksDurableState()
	{
		expect(___IsDurableStatePolicy(___PLATFORM_POLICY.durableState)).toBe(true);
		expect(___PLATFORM_POLICY.durableState).toEqual({
			retention: "until-authorized-deletion",
			storage: "persistent",
			expansion: "online",
			alertBeforeExhaustion: true,
			expandBeforeExhaustion: true,
			backup: "required",
		});
	});

	it("treats the runtime root and lease-scoped workspace as non-authoritative", function _checksRuntimeFilesystem()
	{
		expect(___IsRuntimeFilesystemPolicy(___PLATFORM_POLICY.runtimeFilesystem)).toBe(true);
		expect(___PLATFORM_POLICY.runtimeFilesystem.rootAccess).toBe("read-only-when-supported");
		expect(___PLATFORM_POLICY.runtimeFilesystem.workspaceBackup).toBe("never");
		expect(new Set(___PLATFORM_POLICY.runtimeFilesystem.clearWorkspaceOn)).toEqual(new Set(["replacement", "scale-zero", "lease-expiry"]));
	});

	it("rejects a scratch policy that omits or duplicates a clearing trigger", function _rejectsIncompleteWorkspacePolicy()
	{
		expect(___IsRuntimeFilesystemPolicy({ ...___PLATFORM_POLICY.runtimeFilesystem, clearWorkspaceOn: ["replacement", "scale-zero"] })).toBe(false);
		expect(___IsRuntimeFilesystemPolicy({ ...___PLATFORM_POLICY.runtimeFilesystem, clearWorkspaceOn: ["replacement", "scale-zero", "scale-zero"] })).toBe(false);
	});

	it("requires updates to remount volumes and resume canonical state directly", function _checksUpdatePolicy()
	{
		expect(___IsSiloUpdatePolicy(___PLATFORM_POLICY.siloUpdate)).toBe(true);
		expect(___PLATFORM_POLICY.siloUpdate.maximumDurationExclusiveMs).toBe(5 * 60 * 1000);
		expect(___PLATFORM_POLICY.siloUpdate.predecessorRuntime).toBe("forbidden");
		expect(___PLATFORM_POLICY.siloUpdate.predecessorDataTransformation).toBe("forbidden");
		expect(___IsPlatformPolicy(___PLATFORM_POLICY)).toBe(true);
		expect(___IsPlatformPolicy(null)).toBe(false);
	});

	it("enforces a duration strictly below five minutes", function _checksDuration()
	{
		expect(___IsSiloUpdateDurationAllowed(0)).toBe(true);
		expect(___IsSiloUpdateDurationAllowed(___MAXIMUM_SILO_UPDATE_DURATION_MS - 1)).toBe(true);
		expect(___IsSiloUpdateDurationAllowed(___MAXIMUM_SILO_UPDATE_DURATION_MS)).toBe(false);
		expect(___IsSiloUpdateDurationAllowed(Number.POSITIVE_INFINITY)).toBe(false);
		expect(___IsSiloUpdateDurationAllowed(-1)).toBe(false);
	});
});
