import { readFileSync } from "node:fs";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";

import { _KurrentHistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { OpenCraneHistoryStoreConfig } from "./config.types";
import type { OpenCraneHistoryStoreComposition } from "./history-store-composition.types";

/** Reads the Secret mount before client construction so startup rejects an empty service credential. */
function _readMountedCredential(path: string, name: string): string
{
	const value = readFileSync(path, "utf8").trim();
	if (!value)
		throw new Error(`${name} must contain one non-empty mounted service credential`);
	return value;
}

/** Builds a TLS-verifying KurrentDB connection string so the client verifies the mounted CA. */
function _createConnectionString(config: OpenCraneHistoryStoreConfig, username: string, password: string): string
{
	return `kurrentdb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${config.endpoint}?tlsCAFile=${encodeURIComponent(config.caCertificatePath)}&tlsVerifyCert=true&connectionName=opencrane-history`;
}

/**
 * Composes the process-owned KurrentDB client behind the narrow HistoryStore port.
 *
 * `_Main` calls this before composing admission. ADR 0016 requires KurrentDB history to use TLS and
 * authenticated, least-privilege credentials, so this boundary accepts mounted credentials rather
 * than an application configuration secret or a PostgreSQL substitute.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts`.
 * @see `docs/adr/0016-conversation-history-and-computers.md` for the history and deployment decision.
 * @throws When either mounted service credential is empty or the deployment did not mount the fixed service identity.
 */
export function _CreateHistoryStoreComposition(config: OpenCraneHistoryStoreConfig): OpenCraneHistoryStoreComposition
{
	const username = _readMountedCredential(config.usernamePath, "OPENCRANE_HISTORY_STORE_USERNAME_PATH");
	if (username !== "opencrane-history")
		throw new Error("OPENCRANE_HISTORY_STORE_USERNAME_PATH must contain the fixed opencrane-history service identity");
	const password = _readMountedCredential(config.passwordPath, "OPENCRANE_HISTORY_STORE_PASSWORD_PATH");
	const connectionString = _createConnectionString(config, username, password);
	const client = KurrentDBClient.connectionString(connectionString);
	const historyStore = new _KurrentHistoryStore(client);
	return { close: async function _CloseHistoryStore() { await client.dispose(); }, historyStore };
}
