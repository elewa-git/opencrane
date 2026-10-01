import { Injector, signal } from "@angular/core";
import { describe, expect, it } from "vitest";

import { SessionStore } from "@opencrane/state/core";
import { GOVERNANCE_READ_GATEWAY, GOVERNANCE_READER_IDENTITY } from "@opencrane/state/governance";
import { OpenCraneGovernanceReadGateway } from "@opencrane/state/governance/adapter";

import { provideGovernanceReads } from "../governance.providers";

describe("Governance app composition", function _GovernanceComposition()
{
	it("binds reads without a role-derived grant", function _ReadBindings()
	{
		expect(provideGovernanceReads()).toContainEqual({ provide: GOVERNANCE_READ_GATEWAY, useClass: OpenCraneGovernanceReadGateway });
	});

	it("selects authenticated subject and organisation and clears at sign-out", function _ReaderIdentity()
	{
		const authenticated = signal(false);
		const user = signal<{ sub: string; clusterTenant: string } | undefined>(undefined);
		const injector = Injector.create({ providers: [...provideGovernanceReads(), { provide: SessionStore, useValue: { authenticated, user } }] });
		const identity = injector.get(GOVERNANCE_READER_IDENTITY);
		expect(identity()).toBeNull();
		user.set({ sub: "jane", clusterTenant: "nairobi" });
		expect(identity()).toBeNull();
		authenticated.set(true);
		expect(identity()).toBe(JSON.stringify(["jane", "nairobi"]));
		user.set({ sub: "jane", clusterTenant: "kisumu" });
		expect(identity()).toBe(JSON.stringify(["jane", "kisumu"]));
		authenticated.set(false);
		expect(identity()).toBeNull();
	});
});
