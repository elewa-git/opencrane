const _DEFAULT_PROXY_PORT = 4200;
/** Gives a loaded minimum-size Codespace the same workload-readiness budget as remote CI. */
const _DEFAULT_TIMEOUT_SECONDS = "600";

/** Describes the options printed when the Tier 3 command receives `--help`. */
export const TIER3_DEVELOPMENT_HELP = `OpenCrane Tier 3 k3d development

Usage:
  npm run dev:tier3
  npm run dev:tier3 -- --storage-mode fast
  npm run dev:tier3 -- --smoke-only

Options:
  --storage-mode full|fast  Full storage qualification is the default.
  --proxy-port <port>       Loopback port forwarded by Codespaces (default: 4200).
  --smoke-only              Leave the qualified cluster running without starting the browser proxy.
  --help                    Show this help.

Environment:
  SMOKE_LOW_DISK_IMAGE_IMPORT=0  Preserve build cache and use one batch import on a larger host.
  TIMEOUT_SECONDS=<seconds>      Override the 600-second local readiness budget.
`;

/**
 * Parses the narrow command surface for the Tier 3 developer workflow.
 *
 * Called by: `tier3-development.mjs` and its command-contract tests.
 *
 * @param {readonly string[]} argumentsList - Values after the Node entrypoint.
 * @returns {{ help: boolean, proxyPort: number, smokeOnly: boolean, storageMode: "fast" | "full" }} The selected workflow options.
 */
export function parseTier3Arguments(argumentsList)
{
	const options = {
		help: false,
		proxyPort: _DEFAULT_PROXY_PORT,
		smokeOnly: false,
		storageMode: "full"
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
 * diagnosis. Other smoke inputs stay under the developer's control, except the selected storage
 * profile, which comes from the reviewed command options.
 *
 * Called by: `runTier3Development` before it starts `develop-smoke.sh`.
 *
 * @param {NodeJS.ProcessEnv} parentEnvironment - Developer tool and optional smoke overrides.
 * @param {"fast" | "full"} storageMode - Storage path the smoke must qualify.
 * @returns {{ ingressCertificate: { certificateName: string, namespace: string }, smokeEnvironment: NodeJS.ProcessEnv, upstreamHost: string }} The retained smoke inputs and ingress identity they create.
 */
export function createTier3SessionConfiguration(parentEnvironment, storageMode)
{
	const clusterTenant = parentEnvironment.CLUSTER_TENANT || "smoke";
	const baseDomain = parentEnvironment.BASE_DOMAIN || "develop-smoke.opencrane.test";
	const namespace = parentEnvironment.NAMESPACE || "opencrane-develop-smoke";
	const releaseName = parentEnvironment.RELEASE_NAME || `opencrane-${clusterTenant}`;

	return {
		ingressCertificate: {
			certificateName: `${releaseName}-clustertenant-tls`,
			namespace,
		},
		smokeEnvironment: {
			...parentEnvironment,
			KEEP_CLUSTER: "1",
			SMOKE_LOW_DISK_IMAGE_IMPORT: parentEnvironment.SMOKE_LOW_DISK_IMAGE_IMPORT || "1",
			SMOKE_STORAGE_MODE: storageMode,
			TIMEOUT_SECONDS: parentEnvironment.TIMEOUT_SECONDS || _DEFAULT_TIMEOUT_SECONDS
		},
		upstreamHost: `${clusterTenant}.${baseDomain}`
	};
}
