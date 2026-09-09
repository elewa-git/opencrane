import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

import { Cookie, type SessionData } from "express-session";
import { z } from "zod";

import type { OidcAuthConfig } from "../configuration/oidc-config.types";
import { _OIDC_SESSION_CLOCK_SKEW_MS } from "./oidc-session.constants";
import type { OidcSessionCoordinates } from "./oidc-session-repository.types";
import { _AuthUserSchema } from "./session.validator";

/** Caps identifiers across configuration changes and rolling server replacement. */
const _MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Bounds login-flow state separately from authenticated sessions. */
const _FLOW_LIFETIME_MS = 10 * 60 * 1000;
/** Prevents session envelopes from becoming an unbounded database or decryption input. */
const _MAX_PAYLOAD_BYTES = 64 * 1024;
/** Accepts the data written by the existing OIDC flow, never arbitrary request fields. */
const _Payload = z.object({ cookie: z.object({ originalMaxAge: z.number().finite().nonnegative().nullable(), expires: z.string().datetime({ offset: true }).nullable().optional(), secure: z.boolean(), httpOnly: z.boolean(), path: z.literal("/"), sameSite: z.literal("lax") }).strict(), authUser: _AuthUserSchema.optional(), idToken: z.string().max(32 * 1024).optional(), oidcFlow: z.object({ codeVerifier: z.string().min(1).max(256), state: z.string().min(1).max(256), nonce: z.string().min(1).max(256), returnTo: z.string().max(4096), clientId: z.string().max(2048).optional() }).strict().optional() }).strict();

/**
 * Encrypts sessions with a purpose-separated deployment key and validates their fixed lifetime.
 * The browser's existing signed cookie authenticates the generated identifier and its deadline.
 * @see https://github.com/expressjs/session/blob/v1.19.0/README.md#genid
 */
export class OidcSessionCodec
{
	/** Isolates stored sessions by trusted issuer, client, callback and cookie configuration. */
	readonly namespace: string;
	/** Keeps the session-encryption key separate from cookie signing. */
	private readonly _key: Buffer;
	/** Records the configured maximum when each identifier is generated. */
	private readonly _maxAgeMs: number;
	/** Rejects decrypted identities issued by another provider. */
	private readonly _issuer: string;
	/** Applies current transport protection instead of replaying an older cookie setting. */
	private readonly _cookieSecure: boolean;

	/** Derives storage credentials from the existing persistent session secret. */
	constructor(config: OidcAuthConfig)
	{
		if (Buffer.byteLength(config.sessionSecret, "utf8") < 32)
			throw new Error("OIDC_SESSION_SECRET must contain at least 32 bytes");
		if (!Number.isSafeInteger(config.sessionMaxAgeMs) || config.sessionMaxAgeMs < 1 || config.sessionMaxAgeMs > _MAX_LIFETIME_MS)
			throw new Error("OIDC session lifetime must be positive and at most seven days");
		this.namespace = createHash("sha256").update(JSON.stringify([config.issuerUrl, config.clientId, config.redirectUri, config.cookieName])).digest("hex");
		this._key = Buffer.from(hkdfSync("sha256", config.sessionSecret, this.namespace, "opencrane/oidc-session/encryption/v1", 32));
		this._maxAgeMs = config.sessionMaxAgeMs;
		this._issuer = config.issuerUrl;
		this._cookieSecure = config.cookieSecure;
	}

	/** Creates a random identifier with a deadline that survives configuration changes. */
	generateId(): string
	{
		const now = Date.now();
		return `${now.toString(36)}.${(now + this._maxAgeMs).toString(36)}.${randomBytes(32).toString("base64url")}`;
	}

	/** Rejects malformed, future and expired identifiers before storage can create a row. */
	coordinates(id: string): OidcSessionCoordinates | null
	{
		const match = /^([0-9a-z]{1,11})\.([0-9a-z]{1,11})\.[A-Za-z0-9_-]{43}$/u.exec(id);
		if (match === null)
			return null;
		const born = Number.parseInt(match[1], 36);
		const deadline = Number.parseInt(match[2], 36);
		const now = Date.now();
		if (!Number.isSafeInteger(born) || !Number.isSafeInteger(deadline) || born > now + _OIDC_SESSION_CLOCK_SKEW_MS || deadline <= now || deadline <= born || deadline - born > _MAX_LIFETIME_MS)
			return null;
		return { namespace: this.namespace, idDigest: createHash("sha256").update(id).digest("hex"), now: new Date(now), retainUntil: new Date(deadline) };
	}

	/** Uses the identifier birth for login flows and verified token expiry after login. */
	validUntil(id: string, data: SessionData, command: OidcSessionCoordinates): Date
	{
		let deadline = Number.parseInt(id.split(".")[0], 36) + _FLOW_LIFETIME_MS;
		if (data.authUser !== undefined)
		{
			if (data.authUser.issuer !== this._issuer)
				throw new Error("OIDC session issuer is invalid");
			deadline = Date.parse(data.authUser.authorizationExpiresAt);
		}
		deadline = Math.min(deadline, command.retainUntil.getTime());
		if (!Number.isSafeInteger(deadline) || deadline <= command.now.getTime())
			throw new Error("OIDC session has expired");
		return new Date(deadline);
	}

	/** Encrypts only the existing cookie and OIDC fields with a fresh nonce for every save. */
	encode(data: SessionData, command: OidcSessionCoordinates): string
	{
		const source = JSON.stringify({ cookie: data.cookie, authUser: data.authUser, idToken: data.idToken, oidcFlow: data.oidcFlow });
		if (Buffer.byteLength(source) > _MAX_PAYLOAD_BYTES)
			throw new Error("OIDC session data is too large");
		_Payload.parse(JSON.parse(source));
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this._key, nonce);
		cipher.setAAD(this._Aad(command));
		const encrypted = Buffer.concat([cipher.update(source, "utf8"), cipher.final()]);
		return ["1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
	}

	/** Authenticates and validates a stored envelope before exposing its identity or PKCE data. */
	decode(payload: string, command: OidcSessionCoordinates): SessionData
	{
		try
		{
			if (payload.length > 2 * _MAX_PAYLOAD_BYTES)
				throw new Error("oversize");
			const parts = payload.split(".");
			if (parts.length !== 4 || parts[0] !== "1" || !/^[A-Za-z0-9_-]{16}$/u.test(parts[1]) || !/^[A-Za-z0-9_-]{22}$/u.test(parts[2]) || !/^[A-Za-z0-9_-]+$/u.test(parts[3]))
				throw new Error("invalid envelope");
			const decipher = createDecipheriv("aes-256-gcm", this._key, Buffer.from(parts[1], "base64url"));
			decipher.setAAD(this._Aad(command));
			decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
			const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
			if (plaintext.length > _MAX_PAYLOAD_BYTES)
				throw new Error("oversize");
			const data = _Payload.parse(JSON.parse(plaintext.toString("utf8")));
			const cookie = new Cookie();
			const expires = data.cookie.expires ? new Date(data.cookie.expires) : null;
			Object.assign(cookie, data.cookie, { expires, originalMaxAge: data.cookie.originalMaxAge, secure: this._cookieSecure });
			return { ...data, cookie };
		}
		catch
		{
			throw new Error("OIDC session data is invalid");
		}
	}

	/** Binds ciphertext to its storage namespace, identifier digest and fixed deadline. */
	private _Aad(command: OidcSessionCoordinates): Buffer
	{
		return Buffer.from(JSON.stringify([1, command.namespace, command.idDigest, command.retainUntil.toISOString()]));
	}
}
