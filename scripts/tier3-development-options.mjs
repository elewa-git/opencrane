import { randomBytes } from "node:crypto";

const _DEFAULT_PROXY_PORT = 4200;
/** Gives a loaded minimum-size Codespace the same workload-readiness budget as remote CI. */
const _DEFAULT_TIMEOUT_SECONDS = "600";

/** Describes the options printed when the Tier 3 command receives `--help`. */
export const TIER3_DEVELOPMENT_HELP = `OpenCrane Tier 3 k3d development

Usage:
  npm run dev:tier3
  npm run dev:tier3:infra
  npm run dev:tier3 -- --storage-mode full
  npm run dev:tier3 -- --smoke-only

Options:
  --storage-mode fast|full  Fast storage is the minimum-host default; full proves expansion.
  --proxy-port <port>       Loopback port forwarded by Codespaces (default: 4200).
  --smoke-only              Leave the qualified cluster running without starting the browser proxy.
  --help                    Show this help.

Environment:
  SMOKE_HOST_PROFILE=recommended  Preserve dependencies and caches and use a batch import.
  TIMEOUT_SECONDS=<seconds>       Override the 600-second local readiness budget.
`;

/**
 * Parses the supported Tier 3 command-line options and rejects every other flag.
 *
 * Called by: `tier3-development.mjs` and its command-contract tests.
 *
 * @param {readonly string[]} argumentsList - Values after the Node entrypoint.
 * @returns {{ help: boolean, proxyPort: number, smokeOnly: boolean, storageMode: "fast" | "full" }} The selected workflow options.
 * @throws {Error} When an option is unknown or carries an invalid value.
 */
export function parseTier3Arguments(argumentsList)
{
	const options = {
		help: false,
		proxyPort: _DEFAULT_PROXY_PORT,
		smokeOnly: false,
		storageMode: "fast"
	};

	for (let index = 0; index < argumentsList.length; index += 1)
	{
		const argument = argumentsList[index];

		if (argument === "--help")
		{
			options.help = true;
			continue;
		}

		if (argument === "--smoke-only")
		{
			options.smokeOnly = true;
			continue;
		}

		if (argument === "--storage-mode")
		{
			const value = argumentsList[index + 1];

			if (value !== "fast" && value !== "full")
			{
				throw new Error("--storage-mode must be 'fast' or 'full'.");
			}

			options.storageMode = value;
			index += 1;
			continue;
		}

		if (argument === "--proxy-port")
		{
			const value = Number(argumentsList[index + 1]);

			// The devcontainer runs as the non-root `node` user, which cannot bind a privileged port.
			if (!Number.isInteger(value) || value < 1024 || value > 65_535)
			{
				throw new Error("--proxy-port must be an integer from 1024 through 65535.");
			}

			options.proxyPort = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown Tier 3 option: ${argument}`);
	}

	return options;
}

/**
 * Builds the smoke environment and matching ingress identity for an interactive Tier 3 session.
 *
 * The wrapper always retains the cluster so a passing or failed run remains available for kubectl
 * diagnosis. The command-selected storage mode overrides the matching smoke input. The minimum
 * host profile applies unless the developer explicitly selects the recommended profile.
 *
 * Called by: `runTier3Development` before it starts `develop-smoke.sh`.
 *
 * @param {NodeJS.ProcessEnv} parentEnvironment - Developer tool and optional smoke overrides.
 * @param {"fast" | "full"} storageMode - Storage path the smoke must qualify.
 * @returns {{ ingressCertificate: { certificateName: string, namespace: string }, proxySecret: string, smokeEnvironment: NodeJS.ProcessEnv, upstreamHost: string }} Fresh authentication and retained smoke inputs for this run.
 */
export function createTier3SessionConfiguration(parentEnvironment, storageMode)
{
	const clusterTenant = parentEnvironment.CLUSTER_TENANT || "smoke";
	const baseDomain = parentEnvironment.BASE_DOMAIN || "develop-smoke.opencrane.test";
	const namespace = parentEnvironment.NAMESPACE || "opencrane-develop-smoke";
	const releaseName = parentEnvironment.RELEASE_NAME || `opencrane-${clusterTenant}`;
	const proxySecret = randomBytes(32).toString("base64url");
	const sessionSecret = randomBytes(32).toString("base64url");

	const smokeEnvironment = {
		...parentEnvironment,
		KEEP_CLUSTER: "1",
		OPENCRANE_TIER3_DEVELOPMENT_AUTH: "1",
		OPENCRANE_TIER3_PROXY_SECRET: proxySecret,
		OPENCRANE_TIER3_SESSION_SECRET: sessionSecret,
		SMOKE_HOST_PROFILE: parentEnvironment.SMOKE_HOST_PROFILE || "minimum",
		SMOKE_STORAGE_MODE: storageMode,
		TIMEOUT_SECONDS: parentEnvironment.TIMEOUT_SECONDS || _DEFAULT_TIMEOUT_SECONDS
	};
	return {
		ingressCertificate: {
			certificateName: `${releaseName}-clustertenant-tls`,
			namespace,
		},
		smokeEnvironment,
		proxySecret,
		upstreamHost: `${clusterTenant}.${baseDomain}`
	};
}
