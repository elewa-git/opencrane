import { Injectable, Signal, computed, inject } from "@angular/core";

import { UiMockAccessMode } from "../models/mock-scenario.types.js";
import { UiAccessState, UiIdentity, UiRole } from "../models/ui-data.types.js";
import { MockScenarioService } from "./mock-scenario.service.js";

/** Stable administrator identity used by default mock scenarios. */
const ADMIN_IDENTITY: UiIdentity =
{
	id: "identity-amara",
	name: "Amara Okafor",
	handle: "@amara",
	email: "amara@example.test",
	department: "Product",
	initials: "AO",
	role: UiRole.Administrator
};

/** Supplies deterministic identity, tenant, role, and first-run state to the mock build. */
@Injectable()
export class MockIdentityService
{
	/** Scenario owner controlling the access variant. */
	private readonly _scenarios = inject(MockScenarioService);

	/** Derived access state consumed by mock route guards and the shell. */
	public readonly access: Signal<UiAccessState> = computed(function _accessState(this: MockIdentityService): UiAccessState
	{
		return _AccessState(this._scenarios.accessMode());
	}.bind(this));
}

/** Maps one access mode to a fresh deterministic access state. */
function _AccessState(mode: UiMockAccessMode): UiAccessState
{
	if (mode === UiMockAccessMode.Anonymous)
	{
		return { authenticated: false, tenantId: null, firstRun: false, identity: null };
	}
	if (mode === UiMockAccessMode.NoTenant)
	{
		return { authenticated: true, tenantId: null, firstRun: false, identity: _IdentityFor(mode) };
	}
	return { authenticated: true, tenantId: "tenant-elewa", firstRun: mode === UiMockAccessMode.FirstRun, identity: _IdentityFor(mode) };
}

/** Returns a role-adjusted identity without mutating the shared fixture. */
function _IdentityFor(mode: UiMockAccessMode): UiIdentity
{
	const role = mode === UiMockAccessMode.Member ? UiRole.Member : UiRole.Administrator;
	return { ...ADMIN_IDENTITY, role };
}
