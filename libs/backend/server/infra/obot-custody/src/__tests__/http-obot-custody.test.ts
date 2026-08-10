import { describe, expect, it } from "vitest";

import { __CreateHttpObotCustodyAdapter } from "../http-obot-custody.js";
import { ObotProtocolError, ObotTransportError } from "../obot-http.js";
import type { ObotRequestMethod, ObotSession } from "../obot-http.types.js";
import type { ProvisionObotCustodyCommand } from "../obot-custody.types.js";

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

/** Canonical provisioning command with one write-only credential entry. */
const _COMMAND: ProvisionObotCustodyCommand = { siloId: "silo-1", integrationId: "int-1", obotCatalogEntryId: "cat-1", credential: [{ name: "API_TOKEN", value: "super-secret-value" }] };

describe("HTTP Obot custody adapter", function _CustodySuite()
{
	it("creates then configures, returning only Obot-minted coordinates", async function _Provision()
	{
		const recorded: _RecordedCall[] = [];
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble(recorded, {
			"POST /api/mcp-servers": function _create() { return { id: "srv-9" }; },
			"POST /api/mcp-servers/srv-9/configure": function _configure() { return null; },
		}));
		const before = Date.now();
		const provisioned = await adapter.provision(_COMMAND);
		expect(provisioned.obotCatalogEntryId).toBe("cat-1");
		expect(provisioned.obotCustodyReference).toBe("srv-9");
		// Obot server configs do not expire remotely; the adapter records a far-future bound.
		expect(provisioned.expiresAt.getTime()).toBeGreaterThan(before + 300 * 24 * 60 * 60 * 1_000);
		expect(recorded[0]).toEqual({ path: "/api/mcp-servers", method: "POST", body: { catalogEntryID: "cat-1" } });
		expect(recorded[1]).toEqual({ path: "/api/mcp-servers/srv-9/configure", method: "POST", body: { API_TOKEN: "super-secret-value" } });
	});

	it("adopts a validated remote expiry when the configure response carries one", async function _RemoteExpiry()
	{
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble([], {
			"POST /api/mcp-servers": function _create() { return { id: "srv-9" }; },
			"POST /api/mcp-servers/srv-9/configure": function _configure() { return { expiresAt: "2027-01-01T00:00:00.000Z" }; },
		}));
		await expect(adapter.provision(_COMMAND)).resolves.toMatchObject({ expiresAt: new Date("2027-01-01T00:00:00.000Z") });
	});

	it("compensates by deleting the created server when configure fails, then rethrows", async function _Compensation()
	{
		const recorded: _RecordedCall[] = [];
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble(recorded, {
			"POST /api/mcp-servers": function _create() { return { id: "srv-9" }; },
			"POST /api/mcp-servers/srv-9/configure": function _configure(): unknown { throw new ObotTransportError("http_500"); },
			"DELETE /api/mcp-servers/srv-9": function _delete() { return null; },
		}));
		const failure = await adapter.provision(_COMMAND).then(function _unexpected(): ObotTransportError { throw new Error("expected a transport failure"); }, function _capture(error: unknown) { return error as ObotTransportError; });
		expect(failure).toMatchObject({ name: "ObotTransportError", code: "http_500" });
		expect(failure.message).not.toContain("super-secret-value");
		expect(recorded.map(function _shape(call) { return `${call.method} ${call.path}`; })).toEqual(["POST /api/mcp-servers", "POST /api/mcp-servers/srv-9/configure", "DELETE /api/mcp-servers/srv-9"]);
	});

	it("rethrows the configure failure even when compensation itself fails", async function _CompensationFailure()
	{
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble([], {
			"POST /api/mcp-servers": function _create() { return { id: "srv-9" }; },
			"POST /api/mcp-servers/srv-9/configure": function _configure(): unknown { throw new ObotTransportError("http_500"); },
			"DELETE /api/mcp-servers/srv-9": function _delete(): unknown { throw new ObotTransportError("network"); },
		}));
		await expect(adapter.provision(_COMMAND)).rejects.toMatchObject({ code: "http_500" });
	});

	it("refuses creation responses without an Obot-minted id", async function _ProtocolViolation()
	{
		for (const created of [null, {}, { id: "" }, { id: 42 }, []])
		{
			const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble([], { "POST /api/mcp-servers": function _create() { return created; } }));
			await expect(adapter.provision(_COMMAND)).rejects.toBeInstanceOf(ObotProtocolError);
		}
	});

	it("refuses credential entries without a name before any exchange carries values", async function _BlankCredentialName()
	{
		const recorded: _RecordedCall[] = [];
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble(recorded, {
			"POST /api/mcp-servers": function _create() { return { id: "srv-9" }; },
			"DELETE /api/mcp-servers/srv-9": function _delete() { return null; },
		}));
		await expect(adapter.provision({ ..._COMMAND, credential: [{ name: " ", value: "secret" }] })).rejects.toThrow("non-empty name");
		expect(recorded.some(function _configured(call) { return call.path.endsWith("/configure"); })).toBe(false);
	});

	it("revokes with deconfigure then delete, treating 404 on either as success", async function _Revoke()
	{
		const recorded: _RecordedCall[] = [];
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble(recorded, {
			"POST /api/mcp-servers/srv-9/deconfigure": function _deconfigure() { return null; },
			"DELETE /api/mcp-servers/srv-9": function _delete() { return null; },
		}));
		await adapter.revoke("srv-9");
		expect(recorded.map(function _shape(call) { return `${call.method} ${call.path}`; })).toEqual(["POST /api/mcp-servers/srv-9/deconfigure", "DELETE /api/mcp-servers/srv-9"]);
		// An already-removed remote server answers 404 on both paths; the double has no answers here.
		await expect(__CreateHttpObotCustodyAdapter(_sessionDouble([], {})).revoke("srv-gone")).resolves.toBeUndefined();
	});

	it("propagates non-404 revocation failures", async function _RevokeFailure()
	{
		const adapter = __CreateHttpObotCustodyAdapter(_sessionDouble([], {
			"POST /api/mcp-servers/srv-9/deconfigure": function _deconfigure(): unknown { throw new ObotTransportError("http_500"); },
		}));
		await expect(adapter.revoke("srv-9")).rejects.toMatchObject({ code: "http_500" });
	});
});
