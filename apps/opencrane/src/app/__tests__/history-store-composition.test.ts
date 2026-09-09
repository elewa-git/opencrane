import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createSecureServer, type ServerHttp2Session } from "node:http2";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenCraneHistoryStoreConfig } from "../config.types";
import { _CreateHistoryStoreComposition } from "../history-store-composition";
import type { OpenCraneHistoryStoreComposition } from "../history-store-composition.types";

/** Captures the TLS-only connection string without constructing a network client. */
const _connectionString = vi.hoisted(function _ConnectionString()
{
	return vi.fn();
});

vi.mock("@kurrent/kurrentdb-client", async function _KurrentClient(importOriginal)
{
	const actual = await importOriginal<typeof import("@kurrent/kurrentdb-client")>();
	return { ...actual, KurrentDBClient: { connectionString: _connectionString } };
});

/** Temporary Secret-mount directories created by the current test. */
const _temporaryDirectories: string[] = [];

/** Creates a credential mount and returns the configured KurrentDB connection paths. */
function _historyStoreConfig(username: string = "opencrane-history", password: string = "secret value"): OpenCraneHistoryStoreConfig
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-history-store-"));
	_temporaryDirectories.push(directory);
	const usernamePath = join(directory, "username");
	const passwordPath = join(directory, "password");
	writeFileSync(usernamePath, username);
	writeFileSync(passwordPath, password);
	return {
		caCertificatePath: "/var/run/opencrane/history-store/ca.crt",
		endpoint: "opencrane-kurrentdb.silo.svc:2113",
		passwordPath,
		usernamePath,
	};
}

afterEach(function _RestoreHistoryStoreComposition()
{
	vi.clearAllMocks();
	for (const directory of _temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("_CreateHistoryStoreComposition", function _DescribeHistoryStoreComposition()
{
	it("builds one TLS-verifying client from mounted service credentials", function _CreatesKurrentHistoryStore()
	{
		const dispose = vi.fn();
		const setCredentialsProvider = vi.fn();
		_connectionString.mockReturnValue({ dispose, setCredentialsProvider });

		const composition = _CreateHistoryStoreComposition(_historyStoreConfig("opencrane-history", "secret value+/=%"));

		expect(_connectionString).toHaveBeenCalledWith("kurrentdb://opencrane-kurrentdb.silo.svc:2113?tlsCAFile=%2Fvar%2Frun%2Fopencrane%2Fhistory-store%2Fca.crt&tlsVerifyCert=true&connectionName=opencrane-history");
		expect(setCredentialsProvider.mock.calls[0]?.[0]()).toEqual({ username: "opencrane-history", password: "secret value+/=%" });
		expect(composition.historyStore).toBeDefined();
		return expect(composition.close()).resolves.toBeUndefined().then(function _AssertClose() { expect(dispose).toHaveBeenCalledOnce(); });
	});

	it("refuses empty or unexpected mounted service usernames", function _RejectsInvalidUsername()
	{
		expect(function _EmptyUsername() { _CreateHistoryStoreComposition(_historyStoreConfig("", "password")); }).toThrow(/non-empty mounted service credential/);
		expect(function _UnexpectedUsername() { _CreateHistoryStoreComposition(_historyStoreConfig("history-writer", "password")); }).toThrow(/fixed opencrane-history service identity/);
	});

	it("refuses an empty mounted service password before creating a client", function _RejectsEmptyPassword()
	{
		expect(function _EmptyPassword() { _CreateHistoryStoreComposition(_historyStoreConfig("opencrane-history", "")); }).toThrow(/non-empty mounted service credential/);
		expect(_connectionString).not.toHaveBeenCalled();
	});

	it("sends raw mounted credentials through the real native stream transport over verified TLS", async function _PreservesWireCredentials()
	{
		const sdk = await vi.importActual<typeof import("@kurrent/kurrentdb-client")>("@kurrent/kurrentdb-client");
		_connectionString.mockImplementation(sdk.KurrentDBClient.connectionString);
		const config = _historyStoreConfig("opencrane-history", "test+/=space%value");
		const tls = _createTlsFixture(dirname(config.usernamePath));
		const server = createSecureServer({ key: tls.key, cert: tls.cert });
		const sessions = new Set<ServerHttp2Session>();
		const authorizations: string[] = [];
		server.on("session", function _trackSession(session)
		{
			sessions.add(session);
			session.on("close", function _forgetSession() { sessions.delete(session); });
		});
		server.on("stream", function _observeNativeRequest(stream, headers)
		{
			if (headers[":path"] === "/event_store.client.streams.Streams/Read")
				authorizations.push(String(headers["authorization"]));
			stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
			stream.on("wantTrailers", function _finishProbe() { stream.sendTrailers({ "grpc-status": "12" }); });
			stream.end();
		});
		await new Promise<void>(function _listen(resolve, reject)
		{
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		let composition: OpenCraneHistoryStoreComposition | undefined;
		try
		{
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("The TLS fixture did not bind a TCP endpoint");
			composition = _CreateHistoryStoreComposition({ ...config, endpoint: `127.0.0.1:${address.port}`, caCertificatePath: tls.caCertificatePath });
			const events = composition.historyStore.readStream({ streamName: "opencrane-silo" });
			await expect((async function _consumeProbe()
			{
				for await (const event of events)
					void event;
			})()).rejects.toThrow();
			expect(authorizations).toEqual([`Basic ${Buffer.from("opencrane-history:test+/=space%value").toString("base64")}`]);
		}
		finally
		{
			await composition?.close();
			for (const session of sessions)
				session.destroy();
			await new Promise<void>(function _closeServer(resolve, reject)
			{
				server.close(function _closed(error)
				{
					if (error)
						reject(error);
					else
						resolve();
				});
			});
		}
	}, 15_000);
});

/** Creates a CA and a server-only leaf so the native client must verify real TLS before sending. */
function _createTlsFixture(directory: string)
{
	const caKey = join(directory, "ca.key");
	const caCertificatePath = join(directory, "ca.crt");
	const key = join(directory, "server.key");
	const cert = join(directory, "server.crt");
	const csr = join(directory, "server.csr");
	const extensions = join(directory, "server.cnf");
	writeFileSync(extensions, "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n");
	execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caCertificatePath, "-days", "1", "-subj", "/CN=HistoryStore test CA"], { stdio: "ignore" });
	execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-subj", "/CN=localhost"], { stdio: "ignore" });
	execFileSync("openssl", ["x509", "-req", "-in", csr, "-CA", caCertificatePath, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "1", "-extfile", extensions], { stdio: "ignore" });
	return { caCertificatePath, key: readFileSync(key), cert: readFileSync(cert) };
}
