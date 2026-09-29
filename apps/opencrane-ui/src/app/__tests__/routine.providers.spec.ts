import { Injector, signal } from "@angular/core";
import { describe, expect, it } from "vitest";

import { SessionStore } from "@opencrane/state/core";
import { ROUTINE_GATEWAY, ROUTINE_SESSION } from "@opencrane/state/routines";
import { OpenCraneRoutineGateway } from "@opencrane/state/routines/adapter";

import { provideRoutineComposition } from "../routine.providers";

describe("Routine app providers", function _RoutineAppProviders()
{
	it("binds the routine port to the concrete adapter", function _RoutineGatewayBinding()
	{
		expect(provideRoutineComposition()).toEqual(expect.arrayContaining([{ provide: ROUTINE_GATEWAY, useClass: OpenCraneRoutineGateway }]));
	});

	it("projects authenticated subject and cluster tenant identity only", function _RoutineSessionIdentity()
	{
		const authenticated = signal(false);
		const user = signal<{ sub: string; clusterTenant?: string | null } | undefined>(undefined);
		const injector = Injector.create({ providers: [...provideRoutineComposition(), { provide: SessionStore, useValue: { authenticated, user } }] });
		const identity = injector.get(ROUTINE_SESSION);
		expect(identity()).toBeNull();
		authenticated.set(true);
		user.set({ sub: "subject-current", clusterTenant: "tenant-a" });
		expect(identity()).toBe(JSON.stringify(["subject-current", "tenant-a"]));
		user.set({ sub: "subject-current", clusterTenant: "tenant-b" });
		expect(identity()).toBe(JSON.stringify(["subject-current", "tenant-b"]));
		authenticated.set(false);
		expect(identity()).toBeNull();
	});
});
