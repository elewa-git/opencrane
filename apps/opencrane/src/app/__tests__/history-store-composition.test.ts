import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenCraneHistoryStoreConfig } from "../config.types";

/** Captures the TLS-only connection string without constructing a network client. */
const _connectionString = vi.hoisted(function _ConnectionString()
{
	return vi.fn();
});

vi.mock("@kurrent/kurrentdb-client", function _KurrentClient()
{
	return { KurrentDBClient: { connectionString: _connectionString } };
});

import { _CreateHistoryStoreComposition } from "../history-store-composition";

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
		_connectionString.mockReturnValue({ dispose });

		const composition = _CreateHistoryStoreComposition(_historyStoreConfig("opencrane-history", "secret value"));

		expect(_connectionString).toHaveBeenCalledWith("kurrentdb://opencrane-history:secret%20value@opencrane-kurrentdb.silo.svc:2113?tlsCAFile=%2Fvar%2Frun%2Fopencrane%2Fhistory-store%2Fca.crt&tlsVerifyCert=true&connectionName=opencrane-history");
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
});
