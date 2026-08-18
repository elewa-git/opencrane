// @vitest-environment jsdom

import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from "@angular/router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SessionStore } from "@opencrane/state/core";

import { ___OperatorAccessGuard } from "../operator-access.guard";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });

/** Runs the access guard with settled session state and captures its redirect request. */
async function _GuardResult(authenticated: boolean, registrationOnAnonymous: boolean, url: string): Promise<{ readonly result: boolean | UrlTree; readonly createUrlTree: ReturnType<typeof vi.fn> }>
{
	const createUrlTree = vi.fn().mockReturnValue({ redirect: true });
	const session = { me: { isLoading: signal(false) }, authenticated: signal(authenticated) };
	const route = { data: registrationOnAnonymous ? { registrationOnAnonymous: true } : {} } as ActivatedRouteSnapshot;
	const state = { url } as RouterStateSnapshot;
	TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: session }, { provide: Router, useValue: { createUrlTree } }] });
	const result = await TestBed.runInInjectionContext(function _RunGuard(): Promise<boolean | UrlTree>
	{
		return ___OperatorAccessGuard(route, state) as Promise<boolean | UrlTree>;
	});
	return { result, createUrlTree };
}

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("operator access guard", function _OperatorAccessGuardSuite()
{
	it("offers registration only for the anonymous invitation route", async function _InvitationRegistration()
	{
		const { createUrlTree } = await _GuardResult(false, true, "/invite?token=opaque-signed-token");

		expect(createUrlTree).toHaveBeenCalledWith(["/login"], { queryParams: { prompt: "create", returnTo: "/invite?token=opaque-signed-token" } });
	});

	it("keeps ordinary anonymous redirects on the login flow", async function _OrdinaryLogin()
	{
		const { createUrlTree } = await _GuardResult(false, false, "/settings/members");

		expect(createUrlTree).toHaveBeenCalledWith(["/login"], { queryParams: { returnTo: "/settings/members" } });
	});

	it("allows authenticated invitation acceptance without a redirect", async function _AuthenticatedInvitation()
	{
		const { result, createUrlTree } = await _GuardResult(true, true, "/invite?token=opaque-signed-token");

		expect(result).toBe(true);
		expect(createUrlTree).not.toHaveBeenCalled();
	});
});
