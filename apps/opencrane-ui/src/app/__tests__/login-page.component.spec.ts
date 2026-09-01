// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { signal, ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { SessionStore } from "@opencrane/state/session";

import { LoginPageComponent } from "../login/login-page.component";

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveLoginResource(url): Promise<string>
	{
		if (url.endsWith("login-page.component.html"))
		{
			return readFileSync(join(process.cwd(), "src/app/login/login-page.component.html"), "utf8");
		}
		if (url.endsWith("login-page.component.scss"))
		{
			return "";
		}
		return "";
	});
});

/** Renders the public login page with a settled anonymous session and fixed route parameters. */
function _LoginPage(query: Record<string, string>): { readonly component: LoginPageComponent; readonly fixture: ComponentFixture<LoginPageComponent>; readonly signIn: ReturnType<typeof vi.fn>; readonly signUp: ReturnType<typeof vi.fn> }
{
	const signIn = vi.fn();
	const signUp = vi.fn();
	const session = { me: { isLoading: signal(false), hasValue: signal(false) }, authenticated: signal(false) };
	const route = { snapshot: { queryParamMap: convertToParamMap(query) } };
	TestBed.configureTestingModule({ imports: [LoginPageComponent], providers: [
		{ provide: SessionStore, useValue: session },
		{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
		{ provide: ControlPlaneApiService, useValue: { signIn, signUp } },
		{ provide: ActivatedRoute, useValue: route }
	] });
	const fixture = TestBed.createComponent(LoginPageComponent);
	const component = fixture.componentInstance;
	TestBed.flushEffects();
	fixture.detectChanges();
	return { component, fixture, signIn, signUp };
}

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("invite-aware login page", function _InviteLoginPageSuite()
{
	it("offers registration and login for the exact create prompt", function _CreatePrompt()
	{
		const { component, fixture, signIn, signUp } = _LoginPage({ prompt: "create", returnTo: "/invite?token=opaque" });
		const element = fixture.nativeElement as HTMLElement;
		const buttons = Array.from(element.querySelectorAll("button"));

		expect(component.registrationRequested).toBe(true);
		expect(element.querySelector("h1")?.textContent?.trim()).toBe("Create your account to accept this invitation.");
		expect(element.textContent).toContain("If you already have an account, log in instead.");
		expect(buttons.map(button => button.textContent?.trim())).toEqual(["Create account", "Log in"]);
		buttons[0]?.click();
		buttons[1]?.click();
		expect(signUp).toHaveBeenCalledWith("/invite?token=opaque");
		expect(signIn).toHaveBeenCalledWith("/invite?token=opaque");
	});

	it.each([{}, { prompt: "CREATE" }, { prompt: "login" }])("keeps the ordinary login state for query %#", function _OrdinaryState(query)
	{
		const { component, fixture, signIn, signUp } = _LoginPage(query);
		const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("button"));

		expect(component.registrationRequested).toBe(false);
		expect(buttons.map(button => button.textContent?.trim())).toEqual(["Log in"]);
		buttons[0]?.click();
		expect(signIn).toHaveBeenCalledWith("/");
		expect(signUp).not.toHaveBeenCalled();
	});

	it("sanitizes an external continuation before starting registration", function _UnsafeReturnPath()
	{
		const { component, signUp } = _LoginPage({ prompt: "create", returnTo: "https://attacker.example/invite" });

		component.signUp();
		expect(signUp).toHaveBeenCalledWith("/");
	});
});
