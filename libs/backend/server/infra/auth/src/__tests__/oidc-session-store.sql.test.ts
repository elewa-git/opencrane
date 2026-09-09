import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OidcAuthConfig } from "../oidc-config.types";
import { OidcSessionCodec } from "../oidc-session-codec";
import { ___CreateOidcSessionMiddleware } from "../oidc-session-middleware";
import { OidcSessionStore } from "../oidc-session-store";
import { PrismaOidcSessionUnitOfWork } from "../prisma-oidc-session-repository";
import { _destroySession, _regenerateSession, _saveSession } from "../session";
import { _DestroySession, _ReadSession, _SaveSession, _SessionConfig, _SessionData } from "./oidc-session-store.fixtures";

/** Uses a real independent database connection for each simulated server instance. */
const _First = new PrismaClient();
/** Keeps the second instance independent of the first instance's object state. */
const _Second = new PrismaClient();
/** Isolates each proof from other SQL suites and previous test sessions. */
let _config: OidcAuthConfig;

/** Builds a small HTTP fixture around the production middleware and login lifecycle helpers. */
function _App(prisma: PrismaClient)
{
	const repository = new PrismaOidcSessionUnitOfWork(prisma);
	const app = express();
	app.use(...___CreateOidcSessionMiddleware(_config, repository));
	app.get("/begin", async function _Begin(req, res)
	{
		req.session.oidcFlow = { codeVerifier: "private-verifier", state: "state", nonce: "nonce", returnTo: "/" };
		await _saveSession(req);
		res.sendStatus(204);
	});
	app.get("/complete", async function _Complete(req, res)
	{
		if (req.session.oidcFlow?.state !== "state")
			return void res.sendStatus(401);
		await _regenerateSession(req);
		const data = _SessionData();
		req.session.authUser = { ...data.authUser!, siloId: undefined };
		req.session.idToken = data.idToken;
		await _saveSession(req);
		req.session.authUser.siloId = "silo-1";
		await _saveSession(req);
		res.sendStatus(204);
	});
	app.get("/me", function _Me(req, res) { res.json({ user: req.session.authUser ?? null }); });
	app.post("/logout", async function _Logout(req, res) { await _destroySession(req); res.sendStatus(204); });
	return app;
}

describe("OIDC sessions on a fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The OIDC SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	beforeEach(function _Namespace() { _config = { ..._SessionConfig(), clientId: randomUUID() }; });
	afterEach(async function _Clean()
	{
		vi.restoreAllMocks();
		if (_config !== undefined && process.env.DATABASE_URL)
			await _First.oidcSession.deleteMany({ where: { namespace: new OidcSessionCodec(_config).namespace } });
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("shares PKCE across replicas, regenerates before identity, and logs out every replica", async function _BrowserLifecycle()
	{
		const first = _App(_First);
		const second = _App(_Second);
		const begun = await request(first).get("/begin").expect(204);
		const beforeCookie = begun.headers["set-cookie"][0].split(";")[0];
		const completed = await request(second).get("/complete").set("Cookie", beforeCookie).expect(204);
		const afterCookie = completed.headers["set-cookie"][0].split(";")[0];
		expect(afterCookie).not.toBe(beforeCookie);
		const identity = await request(_App(_First)).get("/me").set("Cookie", afterCookie).expect(200);
		expect(identity.body.user).toMatchObject({ sub: "person-1", siloId: "silo-1" });
		const retired = await request(first).get("/me").set("Cookie", beforeCookie).expect(200);
		expect(retired.body.user).toBeNull();
		await request(second).post("/logout").set("Cookie", afterCookie).expect(204);
		const loggedOut = await request(first).get("/me").set("Cookie", afterCookie).expect(200);
		expect(loggedOut.body.user).toBeNull();
	});

	it("rejects stale loaded and initial saves after logout, including shorter replica configuration", async function _LogoutRaces()
	{
		const original = new OidcSessionStore(_config, new PrismaOidcSessionUnitOfWork(_First));
		const replacement = new OidcSessionStore({ ..._config, sessionMaxAgeMs: 1000 }, new PrismaOidcSessionUnitOfWork(_Second));
		const id = original.generateId();
		await _SaveSession(original, id, _SessionData());
		const stale = (await _ReadSession(original, id))!;
		await _DestroySession(replacement, id);
		await expect(_SaveSession(original, id, stale)).rejects.toThrow("changed or expired");
		await expect(_ReadSession(original, id)).resolves.toBeNull();
		const firstSaveId = original.generateId();
		await _DestroySession(replacement, firstSaveId);
		await expect(_SaveSession(original, firstSaveId, _SessionData())).rejects.toThrow("already saved or destroyed");
	});

	it("lets one concurrent revision save win and never overwrites it from a stale request", async function _ConcurrentSave()
	{
		const first = new OidcSessionStore(_config, new PrismaOidcSessionUnitOfWork(_First));
		const second = new OidcSessionStore(_config, new PrismaOidcSessionUnitOfWork(_Second));
		const id = first.generateId();
		await _SaveSession(first, id, _SessionData());
		const left = (await _ReadSession(first, id))!;
		const right = (await _ReadSession(second, id))!;
		const results = await Promise.allSettled([_SaveSession(first, id, left), _SaveSession(second, id, right)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
	});

	it("keeps encrypted data private and rejects storage tampering and foreign deployments", async function _StoredAuthority()
	{
		const repository = new PrismaOidcSessionUnitOfWork(_First);
		const store = new OidcSessionStore(_config, repository);
		const id = store.generateId();
		await _SaveSession(store, id, _SessionData());
		const namespace = new OidcSessionCodec(_config).namespace;
		const row = await _First.oidcSession.findFirstOrThrow({ where: { namespace } });
		expect(JSON.stringify(row)).not.toContain("private-id-token");
		expect(JSON.stringify(row)).not.toContain(id);
		const foreign = new OidcSessionStore({ ..._config, clientId: "foreign" }, new PrismaOidcSessionUnitOfWork(_Second));
		await expect(_ReadSession(foreign, id)).resolves.toBeNull();
		await _First.oidcSession.update({ where: { namespace_idDigest: { namespace, idDigest: row.idDigest } }, data: { payload: "altered" } });
		await expect(_ReadSession(store, id)).rejects.toThrow("data is invalid");
	});

	it("prunes a bounded batch and refuses resurrection after the identifier deadline", async function _Cleanup()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const repository = new PrismaOidcSessionUnitOfWork(_First);
		const store = new OidcSessionStore({ ..._config, sessionMaxAgeMs: 1000 }, repository);
		const id = store.generateId();
		await _DestroySession(store, id);
		const namespace = new OidcSessionCodec(_config).namespace;
		await _First.oidcSession.createMany({ data: Array.from({ length: 104 }, function _Expired(_, index) { return { namespace, idDigest: `expired-${index}`, payload: null, validUntil: new Date(now - 1000), retainUntil: new Date(now - 1) }; }) });
		clock.mockReturnValue(now + 61_001);
		await expect(repository.prune(namespace, new Date(Date.now()))).resolves.toBe(100);
		await expect(repository.prune(namespace, new Date(Date.now()))).resolves.toBe(5);
		const longer = new OidcSessionStore(_config, new PrismaOidcSessionUnitOfWork(_Second));
		await expect(_SaveSession(longer, id, _SessionData())).rejects.toThrow("expired");
		await expect(_ReadSession(longer, id)).resolves.toBeNull();
	});

	it("retains logout through clock skew before rejecting a slower replica's delayed first save", async function _ClockSkewCleanup()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const fastRepository = new PrismaOidcSessionUnitOfWork(_First);
		const fast = new OidcSessionStore({ ..._config, sessionMaxAgeMs: 1000 }, fastRepository);
		const slow = new OidcSessionStore(_config, new PrismaOidcSessionUnitOfWork(_Second));
		const id = fast.generateId();
		await _DestroySession(fast, id);
		const namespace = new OidcSessionCodec(_config).namespace;
		clock.mockReturnValue(now + 1001);
		await expect(fastRepository.prune(namespace, new Date(Date.now()))).resolves.toBe(0);
		clock.mockReturnValue(now + 500);
		await expect(_SaveSession(slow, id, _SessionData())).rejects.toThrow("already saved or destroyed");
		await expect(_ReadSession(slow, id)).resolves.toBeNull();
		clock.mockReturnValue(now + 61_001);
		await expect(fastRepository.prune(namespace, new Date(Date.now()))).resolves.toBe(1);
		clock.mockReturnValue(now + 1001);
		await expect(_SaveSession(slow, id, _SessionData())).rejects.toThrow("expired");
		await expect(_ReadSession(slow, id)).resolves.toBeNull();
	});
});
