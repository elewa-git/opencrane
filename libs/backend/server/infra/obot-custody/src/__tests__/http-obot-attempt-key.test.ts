import { describe, expect, it } from "vitest";

import { __CreateHttpObotAttemptKeyIssuer } from "../http-obot-attempt-key.js";
import { ObotProtocolError, ObotTransportError } from "../obot-http.js";
import type { ObotRequestMethod, ObotSession } from "../obot-http.types.js";

/** One recorded management exchange. */
interface _RecordedCall
{
	/** Request path. */
	readonly path: string;
	/** Request method. */
	readonly method: ObotRequestMethod;
	/** Request body, when present. */
	readonly body: unknown;
}

/** Builds a session double answering by `<method> <path>` and recording every exchange. */
function _sessionDouble(recorded: _RecordedCall[], answers: Record<string, () => unknown>): ObotSession
{
	return {
		async request(path: string, method: ObotRequestMethod, body?: unknown): Promise<unknown>
		{
			recorded.push({ path, method, body });
			const answer = answers[`${method} ${path}`];
			if (answer === undefined) throw new ObotTransportError("http_404");
			return answer();
		},
	};
}

/** Canonical mint command scoped to two assigned MCP servers. */
const _COMMAND = { obotCustodyReferences: ["srv-1", "srv-2"], name: "attempt-abc123", expiresAt: new Date("2026-08-05T10:00:00.000Z") } as const;

describe("HTTP Obot attempt-key issuer", function _AttemptKeySuite()
{
	it("mints one key scoped to the exact server ids with a lease-bounded expiry", async function _Issue()
	{
		const recorded: _RecordedCall[] = [];
		const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble(recorded, {
			"POST /api/api-keys": function _create() { return { id: "key-7", key: "ok1-user-key7-secret" }; },
		}));
		await expect(issuer.issueAttemptKey(_COMMAND)).resolves.toEqual({ key: "ok1-user-key7-secret", keyId: "key-7" });
		expect(recorded[0]).toEqual({ path: "/api/api-keys", method: "POST", body: { name: "attempt-abc123", expiresAt: "2026-08-05T10:00:00.000Z", mcpServerIds: ["srv-1", "srv-2"] } });
	});

	it("accepts the alternative token field spelling, validated", async function _TokenSpelling()
	{
		const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble([], {
			"POST /api/api-keys": function _create() { return { keyId: "key-8", token: "ok1-user-key8-secret" }; },
		}));
		await expect(issuer.issueAttemptKey(_COMMAND)).resolves.toEqual({ key: "ok1-user-key8-secret", keyId: "key-8" });
	});

	it("refuses key responses missing a validated key value or key id", async function _ProtocolViolation()
	{
		for (const created of [null, {}, { key: "" }, { key: 42, id: "key-7" }, { key: "value" }, { key: "value", id: "" }])
		{
			const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble([], { "POST /api/api-keys": function _create() { return created; } }));
			await expect(issuer.issueAttemptKey(_COMMAND)).rejects.toBeInstanceOf(ObotProtocolError);
		}
	});

	it("refuses an unscoped mint before any exchange", async function _UnscopedMint()
	{
		const recorded: _RecordedCall[] = [];
		const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble(recorded, {}));
		await expect(issuer.issueAttemptKey({ ..._COMMAND, obotCustodyReferences: [] })).rejects.toThrow("at least one");
		await expect(issuer.issueAttemptKey({ ..._COMMAND, obotCustodyReferences: [" "] })).rejects.toThrow("at least one");
		expect(recorded).toEqual([]);
	});

	it("revokes idempotently: a 404 counts as already revoked", async function _Revoke()
	{
		const recorded: _RecordedCall[] = [];
		const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble(recorded, {
			"DELETE /api/api-keys/key-7": function _delete() { return null; },
		}));
		await expect(issuer.revokeAttemptKey("key-7")).resolves.toBeUndefined();
		await expect(issuer.revokeAttemptKey("key-gone")).resolves.toBeUndefined();
		await expect(__CreateHttpObotAttemptKeyIssuer(_sessionDouble([], {
			"DELETE /api/api-keys/key-7": function _delete(): unknown { throw new ObotTransportError("http_500"); },
		})).revokeAttemptKey("key-7")).rejects.toMatchObject({ code: "http_500" });
	});

	it("never carries the minted key value in a failure message", async function _NoKeyLeak()
	{
		const issuer = __CreateHttpObotAttemptKeyIssuer(_sessionDouble([], {
			"POST /api/api-keys": function _create() { return { key: "ok1-leak-candidate", id: 42 }; },
		}));
		const failure = await issuer.issueAttemptKey(_COMMAND).then(function _unexpected(): Error { throw new Error("expected a protocol failure"); }, function _capture(error: unknown) { return error as Error; });
		expect(failure).toBeInstanceOf(ObotProtocolError);
		expect(failure.message).not.toContain("ok1-leak-candidate");
	});
});
