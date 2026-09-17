import express from "express";
import type { Logger } from "pino";
import request, { type Test } from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _RequestHost, _ResolveRequestPrincipal, type AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import { _CreateDevelopmentAuthentication } from "../authentication";
import { _DEVELOPMENT_IDENTITY } from "../config";

/** Exact per-launch credential supplied to the focused browser boundary. */
const _BROWSER_CREDENTIAL = "a".repeat(43);

/** Build durable admission for the seeded identity. */
function _Admission(): AuthenticatedPrincipalAdmission
{
	return {
		admit: vi.fn().mockResolvedValue({
			issuer: _DEVELOPMENT_IDENTITY.issuer,
			principalId: _DEVELOPMENT_IDENTITY.principalId,
			siloId: _DEVELOPMENT_IDENTITY.siloId,
			subject: _DEVELOPMENT_IDENTITY.subjectId,
		}),
	};
}

/** Build the development middleware in listener order. */
function _App(admission: AuthenticatedPrincipalAdmission = _Admission(), browserOrigin?: string, logger: Logger = { warn: vi.fn() } as unknown as Logger)
{
	const capabilities: AuthenticatedPrincipalCapabilityReader = { canAdministerOrganization: vi.fn().mockResolvedValue(true) };
	const authentication = _CreateDevelopmentAuthentication(_DEVELOPMENT_IDENTITY, capabilities, admission, _BROWSER_CREDENTIAL, logger, browserOrigin);
	const app = express();
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", authentication.router);
	app.use(authentication.authMiddleware);
	app.get("/api/v1/protected", function _Protected(incoming, response): void
	{
		const principal = _ResolveRequestPrincipal(incoming);
		response.json({
			principalId: incoming.authenticatedPrincipal?.principalId,
			requestHost: _RequestHost(incoming),
			siloId: principal?.siloId,
		});
	});
	app.post("/api/v1/protected", function _Mutating(_incoming, response): void
	{
		response.status(204).end();
	});
	return app;
}

/** Build a Supertest request with the headers expected from an Angular-proxied, same-origin browser click. */
function _BrowserHandoff(app: ReturnType<typeof _App>, browserOrigin = "http://local-development.localhost:4200"): Test
{
	const browserHost = new URL(browserOrigin).host;
	const headers = {
		"Host": "127.0.0.1:8080",
		"Referer": `${browserOrigin}/`,
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "same-origin",
		"Sec-Fetch-User": "?1",
		"X-Forwarded-Host": browserHost,
	};
	const navigation = request(app).get("/api/v1/auth/development-session").set(headers);

	return navigation;
}

describe("Tier 2 development authentication", function _Suite(): void
{
	it("admits the seeded Principal through durable projection", async function _Admits(): Promise<void>
	{
		const response = await request(_App()).get("/api/v1/protected").set("Host", "local-development.localhost:8080").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(200);
		expect(response.body.principalId).toBe("local-development-principal");
		expect(response.body.siloId).toBe("local-development");
	});

	it("presents the fixed development silo to product resolvers after Codespaces admission", async function _ResolvesCodespacesSilo(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const response = await request(_App(_Admission(), browserOrigin)).get("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			principalId: "local-development-principal",
			requestHost: "careful-crane-123-4200.app.github.dev",
			siloId: "local-development",
		});
	});

	it("refuses an unexpected host before Principal admission", async function _RejectsHost(): Promise<void>
	{
		const admission = _Admission();
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "localhost:8080");
		expect(response.status).toBe(403);
		expect(admission.admit).not.toHaveBeenCalled();
	});

	it("refuses the seeded Principal without the per-launch browser credential", async function _RejectsMissingCredential(): Promise<void>
	{
		const admission = _Admission();
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "local-development.localhost:8080");
		expect(response.status).toBe(401);
		expect(response.body.code).toBe("DEVELOPMENT_SESSION_REQUIRED");
		expect(admission.admit).not.toHaveBeenCalled();
	});

	it("refuses a state change from another browser origin", async function _RejectsOrigin(): Promise<void>
	{
		const response = await request(_App()).post("/api/v1/protected").set("Host", "local-development.localhost:8080").set("Origin", "http://attacker.localhost:4200").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(403);
		expect(response.body.code).toBe("DEVELOPMENT_ORIGIN_MISMATCH");
	});

	it("accepts the exact Angular proxy host and origin", async function _AcceptsProxy(): Promise<void>
	{
		const response = await request(_App()).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "local-development.localhost:4200").set("Origin", "http://local-development.localhost:4200").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(204);
	});

	it("redirects a same-origin browser click to the private fragment without a response body", async function _CompletesHandoff(): Promise<void>
	{
		const admission = _Admission();
		const response = await _BrowserHandoff(_App(admission));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`http://local-development.localhost:4200/#development-session=${_BROWSER_CREDENTIAL}`);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.headers.pragma).toBe("no-cache");
		expect(response.headers["referrer-policy"]).toBe("no-referrer");
		expect(response.text).toBe("");
		expect(admission.admit).not.toHaveBeenCalled();
	});

	it("redirects only through the selected private Codespaces proxy tuple", async function _CompletesCodespacesHandoff(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const response = await _BrowserHandoff(_App(_Admission(), browserOrigin), browserOrigin);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${browserOrigin}/#development-session=${_BROWSER_CREDENTIAL}`);
	});

	it("refuses a handoff from another host or browser origin", async function _RejectsHandoffOrigin(): Promise<void>
	{
		const wrongHost = await _BrowserHandoff(_App()).set("X-Forwarded-Host", "other.localhost:4200");
		const wrongReferer = await _BrowserHandoff(_App()).set("Referer", "http://attacker.localhost:4200/");

		expect(wrongHost.status).toBe(403);
		expect(wrongReferer.status).toBe(403);
	});

	it("refuses scripted, embedded or non-user-activated handoff requests", async function _RejectsNonUserNavigation(): Promise<void>
	{
		const scripted = await _BrowserHandoff(_App()).set("Sec-Fetch-Mode", "cors");
		const embedded = await _BrowserHandoff(_App()).set("Sec-Fetch-Dest", "iframe");
		const crossSite = await _BrowserHandoff(_App()).set("Sec-Fetch-Site", "cross-site");
		const noActivation = await _BrowserHandoff(_App()).unset("Sec-Fetch-User");
		const direct = await _BrowserHandoff(_App()).unset("Referer");

		expect(scripted.status).toBe(403);
		expect(embedded.status).toBe(403);
		expect(crossSite.status).toBe(403);
		expect(noActivation.status).toBe(403);
		expect(direct.status).toBe(403);
	});

	it("refuses non-GET methods before the development authentication router", async function _RejectsHandoffMethod(): Promise<void>
	{
		const headers = {
			"Host": "127.0.0.1:8080",
			"Referer": "http://local-development.localhost:4200/",
			"Sec-Fetch-Dest": "document",
			"Sec-Fetch-Mode": "navigate",
			"Sec-Fetch-Site": "same-origin",
			"Sec-Fetch-User": "?1",
			"X-Forwarded-Host": "local-development.localhost:4200",
		};
		const post = await request(_App()).post("/api/v1/auth/development-session").set(headers);
		const head = await request(_App()).head("/api/v1/auth/development-session").set(headers);

		expect(post.status).toBe(403);
		expect(head.status).toBe(403);
	});

	it("admits only the selected private HTTPS Codespaces proxy tuple", async function _CodespacesProxy(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const accepted = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Origin", browserOrigin).set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const wrongHost = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "other-4200.app.github.dev").set("Origin", browserOrigin).set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const wrongScheme = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Origin", "http://careful-crane-123-4200.app.github.dev").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(accepted.status).toBe(204);
		expect(wrongHost.status).toBe(403);
		expect(wrongScheme.status).toBe(403);
	});

	it("admits same-origin Codespaces fetches when the private proxy omits URL headers", async function _CodespacesFetchMetadata(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const accepted = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const crossSite = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Sec-Fetch-Site", "cross-site").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const directHost = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "local-development.localhost:8080").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const emptyOrigin = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Origin", "").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const emptyReferer = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Referer", "").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const missingMetadata = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const wrongReferer = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Referer", "https://attacker.example/").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		const opaqueOrigin = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Origin", "null").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);

		expect(accepted.status).toBe(204);
		expect(crossSite.status).toBe(403);
		expect(directHost.status).toBe(403);
		expect(emptyOrigin.status).toBe(403);
		expect(emptyReferer.status).toBe(403);
		expect(missingMetadata.status).toBe(403);
		expect(wrongReferer.status).toBe(403);
		expect(opaqueOrigin.status).toBe(403);
	});

	it("admits the Codespaces loopback Origin rewrite only with matching external browser evidence", async function _CodespacesOriginRewrite(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const proxyHeaders = {
			"Host": "127.0.0.1:8080",
			"Origin": "https://localhost:4200",
			"Referer": `${browserOrigin}/onboarding`,
			"Sec-Fetch-Site": "same-origin",
			"X-Forwarded-Host": "careful-crane-123-4200.app.github.dev",
			"X-OpenCrane-Development-Session": _BROWSER_CREDENTIAL,
		};
		const accepted = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders);
		const missingReferer = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).unset("Referer");
		const wrongReferer = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("Referer", "https://attacker.example/");
		const malformedReferer = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("Referer", "not-a-url");
		const crossSite = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("Sec-Fetch-Site", "cross-site");
		const missingFetchMetadata = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).unset("Sec-Fetch-Site");
		const wrongRewrite = await request(_App(_Admission(), browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("Origin", "http://localhost:4200");
		const deniedAdmission = _Admission();
		const wrongInternalHost = await request(_App(deniedAdmission, browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("Host", "127.0.0.1:9090");
		const wrongCredential = await request(_App(deniedAdmission, browserOrigin)).post("/api/v1/protected").set(proxyHeaders).set("X-OpenCrane-Development-Session", "b".repeat(43));

		expect(accepted.status).toBe(204);
		expect(missingReferer.status).toBe(403);
		expect(wrongReferer.status).toBe(403);
		expect(malformedReferer.status).toBe(403);
		expect(crossSite.status).toBe(403);
		expect(missingFetchMetadata.status).toBe(403);
		expect(wrongRewrite.status).toBe(403);
		expect(wrongInternalHost.status).toBe(403);
		expect(wrongInternalHost.body.code).toBe("DEVELOPMENT_HOST_MISMATCH");
		expect(wrongCredential.status).toBe(401);
		expect(wrongCredential.body.code).toBe("DEVELOPMENT_SESSION_REQUIRED");
		expect(deniedAdmission.admit).not.toHaveBeenCalled();
	});

	it("logs safe proxy evidence when a Codespaces state change has another origin", async function _LogsOriginMismatch(): Promise<void>
	{
		const browserOrigin = "https://careful-crane-123-4200.app.github.dev";
		const warn = vi.fn();
		const logger = { warn } as unknown as Logger;
		const response = await request(_App(_Admission(), browserOrigin, logger)).post("/api/v1/protected?secret=not-logged").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "careful-crane-123-4200.app.github.dev").set("Origin", "https://attacker.example/private?secret=not-logged").set("Referer", "https://attacker.example/review?secret=not-logged").set("Sec-Fetch-Site", "same-origin").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);

		expect(response.status).toBe(403);
		expect(warn).toHaveBeenCalledWith({
			browserOrigin,
			forwardedHost: "careful-crane-123-4200.app.github.dev",
			host: "127.0.0.1:8080",
			method: "POST",
			origin: "https://attacker.example",
			path: "/api/v1/protected",
			refererOrigin: "https://attacker.example",
			secFetchSite: "same-origin",
		}, "Tier 2 state change origin did not match the development browser");
	});

	it("fails closed when the durable Principal is absent", async function _RejectsAbsentPrincipal(): Promise<void>
	{
		const admission: AuthenticatedPrincipalAdmission = { admit: vi.fn().mockResolvedValue(null) };
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "local-development.localhost:8080").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(401);
	});
});
