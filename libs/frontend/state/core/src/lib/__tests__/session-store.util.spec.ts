import { describe, expect, it } from "vitest";

import { _DeriveCapabilities } from "../session-store.util";

describe("_DeriveCapabilities", () =>
{
	/** Every capability false — the fail-closed shape, reused across cases. */
	const _NONE = {
		isOperator: false,
		isPlatformOperator: false,
		customerAdmin: false,
		manageCustomers: false,
		managePolicies: false,
		manageBudgets: false
	};

	it("grants every capability for a platform operator on the platform surface", () =>
	{
		const caps = _DeriveCapabilities(true, true, false, "platform");

		expect(caps).toEqual({
			isOperator: true,
			isPlatformOperator: true,
			customerAdmin: false,
			manageCustomers: true,
			managePolicies: true,
			manageBudgets: true
		});
	});

	it("grants the operator console + account powers to a customer admin on the org surface, but not fleet-wide customer management", () =>
	{
		const caps = _DeriveCapabilities(true, false, true, "org");

		expect(caps.customerAdmin).toBe(true);
		expect(caps.isOperator).toBe(true);
		// Fleet-wide flags stay exclusive to the platform operator.
		expect(caps.isPlatformOperator).toBe(false);
		expect(caps.manageCustomers).toBe(false);
	});

	it("ignores a role claim that does not belong to the app's surface (strict domain separation)", () =>
	{
		// A platform-operator token used on the org surface grants nothing...
		expect(_DeriveCapabilities(true, true, false, "org")).toEqual(_NONE);
		// ...and an org-admin token used on the platform surface grants nothing.
		expect(_DeriveCapabilities(true, false, true, "platform")).toEqual(_NONE);
	});

	it("derives manageCustomers from the platform-operator claim on the platform surface alone", () =>
	{
		expect(_DeriveCapabilities(true, true, false, "platform").manageCustomers).toBe(true);
		expect(_DeriveCapabilities(true, false, true, "org").manageCustomers).toBe(false);
		expect(_DeriveCapabilities(true, false, false, "platform").manageCustomers).toBe(false);
	});

	it("denies the operator console to an authenticated session with no operator/admin claim", () =>
	{
		// The tightened least-privilege model: authentication alone no longer grants
		// operator-tier access — a real platform-operator or org-admin claim is required.
		expect(_DeriveCapabilities(true, false, false, "platform")).toEqual(_NONE);
	});

	it("denies everything when unauthenticated, even if role flags are set", () =>
	{
		expect(_DeriveCapabilities(false, true, true, "platform")).toEqual(_NONE);
	});
});
