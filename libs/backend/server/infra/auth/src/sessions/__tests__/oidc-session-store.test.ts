import type { Request } from "express";
import type { SessionData } from "express-session";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OidcSessionCodec } from "../oidc-session-codec";
import { ___CreateOidcSessionMiddleware } from "../oidc-session-middleware";
import type { OidcSessionRepository, SaveOidcSession } from "../oidc-session-repository.types";
import { OidcSessionStore } from "../oidc-session-store";
import { _ReadSession, _SaveSession, _SessionConfig, _SessionData } from "./oidc-session-store.fixtures";

/** Provides storage callbacks without bypassing actual encryption and revision transfer. */
function _Repository()
{
	const saved: SaveOidcSession[] = [];
	const repository = {
		read: vi.fn(async function _Read() { const last = saved.at(-1); return last === undefined ? null : { payload: last.payload, validUntil: last.validUntil, revision: saved.length }; }),
		save: vi.fn(async function _Save(command: SaveOidcSession) { saved.push(command); return saved.length; }),
		destroy: vi.fn().mockResolvedValue(undefined),
		prune: vi.fn().mockResolvedValue(0),
	} satisfies OidcSessionRepository;
	return { repository, saved };
}

describe("persistent OIDC session store", function _Suite()
{
	afterEach(function _ResetClock() { vi.restoreAllMocks(); });

	it("encrypts secrets and transfers revisions through Express inflation and consecutive saves", async function _RevisionTransfer()
	{
		const f = _Repository();
		const first = new OidcSessionStore(_SessionConfig(), f.repository);
		const second = new OidcSessionStore(_SessionConfig(), f.repository);
		const id = first.generateId();
		const data = _SessionData();
		await _SaveSession(first, id, data);
		expect(f.saved[0].expectedRevision).toBeNull();
		expect(f.saved[0].payload).not.toContain("private-id-token");
		expect(f.saved[0].idDigest).not.toBe(id);
		await _SaveSession(first, id, data);
		expect(f.saved[1].expectedRevision).toBe(1);
		const loaded = await _ReadSession(second, id);
		expect(loaded?.authUser).toEqual(data.authUser);
		const request = { sessionID: id, sessionStore: second } as unknown as Request;
		const inflated = second.createSession(request, loaded!);
		expect(Object.keys(inflated)).not.toContain("revision");
		await _SaveSession(second, id, inflated);
		expect(f.saved[2].expectedRevision).toBe(2);
		expect(f.saved[1].payload).not.toBe(f.saved[0].payload);
	});

	it("bounds pre-login PKCE and authenticated expiry independently of rolling cookie age", async function _Expiry()
	{
		const f = _Repository();
		const store = new OidcSessionStore(_SessionConfig(), f.repository);
		const data = _SessionData();
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now);
		const id = store.generateId();
		data.authUser = undefined;
		data.idToken = undefined;
		data.oidcFlow = { codeVerifier: "secret-verifier", state: "state", nonce: "nonce", returnTo: "/" };
		await _SaveSession(store, id, data);
		expect(f.saved[0].validUntil.getTime()).toBe(now + 10 * 60 * 1000);
		expect(f.saved[0].payload).not.toContain("secret-verifier");
		const touch = vi.fn();
		store.touch(id, data, touch);
		expect(touch).toHaveBeenCalledOnce();
		expect(f.repository.save).toHaveBeenCalledOnce();
		vi.mocked(Date.now).mockReturnValue(now + 11 * 60 * 1000);
		await expect(_SaveSession(store, id, data)).rejects.toThrow("expired");
	});

	it("does not extend an old identifier when a later server has a longer session lifetime", async function _ImmutableDeadline()
	{
		const f = _Repository();
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now);
		const original = new OidcSessionStore({ ..._SessionConfig(), sessionMaxAgeMs: 1000 }, f.repository);
		const id = original.generateId();
		const longer = new OidcSessionStore(_SessionConfig(), f.repository);
		vi.mocked(Date.now).mockReturnValue(now + 1001);
		await expect(_SaveSession(longer, id, _SessionData())).rejects.toThrow("expired");
		await expect(_ReadSession(longer, id)).resolves.toBeNull();
		expect(f.repository.save).not.toHaveBeenCalled();
	});

	it.each(["ciphertext", "key", "namespace", "identifier"])("rejects changed %s before returning identity", function _Tamper(kind)
	{
		const config = _SessionConfig();
		const codec = new OidcSessionCodec(config);
		const coordinates = codec.coordinates(codec.generateId())!;
		let payload = codec.encode(_SessionData(), coordinates);
		let reader = codec;
		let destination = coordinates;
		if (kind === "ciphertext")
		{
			const parts = payload.split(".");
			const ciphertext = Buffer.from(parts[3], "base64url");
			ciphertext[0] ^= 1;
			parts[3] = ciphertext.toString("base64url");
			payload = parts.join(".");
		}
		if (kind === "key")
			reader = new OidcSessionCodec({ ...config, sessionSecret: "another-long-test-secret-with-at-least-thirty-two-bytes" });
		if (kind === "namespace")
			destination = { ...coordinates, namespace: "other-deployment" };
		if (kind === "identifier")
			destination = { ...coordinates, idDigest: "other-session" };
		expect(function _Decode() { reader.decode(payload, destination); }).toThrow("invalid");
	});

	it("refuses another issuer, malformed data, oversize payloads and unavailable storage", async function _FailClosed()
	{
		const f = _Repository();
		const store = new OidcSessionStore(_SessionConfig(), f.repository);
		const data = _SessionData();
		data.authUser!.issuer = "https://other.example";
		await expect(_SaveSession(store, store.generateId(), data)).rejects.toThrow("issuer");
		await expect(_SaveSession(store, store.generateId(), { ..._SessionData(), idToken: "x".repeat(70 * 1024) })).rejects.toThrow("large");
		await expect(_SaveSession(store, store.generateId(), { ..._SessionData(), authUser: { ..._SessionData().authUser, sub: 7 } } as unknown as SessionData)).rejects.toThrow();
		f.repository.read.mockRejectedValue(new Error("database unavailable"));
		await expect(_ReadSession(store, store.generateId())).rejects.toThrow("database unavailable");
	});

	it("uses current cookie security and rechecks expiry after a delayed database read", async function _CurrentRead()
	{
		const f = _Repository();
		const original = new OidcSessionStore(_SessionConfig(), f.repository);
		const replacement = new OidcSessionStore({ ..._SessionConfig(), cookieSecure: true }, f.repository);
		const id = original.generateId();
		const data = _SessionData();
		await _SaveSession(original, id, data);
		await expect(_ReadSession(replacement, id)).resolves.toMatchObject({ cookie: { secure: true } });
		const expires = f.saved[0].validUntil.getTime();
		const clock = vi.spyOn(Date, "now").mockReturnValue(expires - 1);
		f.repository.read.mockImplementationOnce(async function _DelayedRead()
		{
			clock.mockReturnValue(expires + 1);
			return { payload: f.saved[0].payload, validUntil: f.saved[0].validUntil, revision: 1 };
		});
		await expect(_ReadSession(replacement, id)).resolves.toBeNull();
	});

	it("does not acknowledge a save that expires while waiting for the database", async function _DelayedSave()
	{
		const f = _Repository();
		const store = new OidcSessionStore(_SessionConfig(), f.repository);
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const data = _SessionData();
		f.repository.save.mockImplementationOnce(async function _Delayed()
		{
			clock.mockReturnValue(Date.parse(data.authUser!.authorizationExpiresAt) + 1);
			return 1;
		});
		await expect(_SaveSession(store, store.generateId(), data)).rejects.toThrow("expired while");
	});

	it("requires persistent storage for OIDC and leaves disabled authentication without sessions", function _ExplicitStore()
	{
		expect(function _MissingStore() { ___CreateOidcSessionMiddleware(_SessionConfig()); }).toThrow("persistent session storage");
		expect(___CreateOidcSessionMiddleware({ ..._SessionConfig(), enabled: false })).toHaveLength(1);
		expect(function _WeakSecret() { new OidcSessionStore({ ..._SessionConfig(), sessionSecret: "short" }, _Repository().repository); }).toThrow("32 bytes");
	});
});
