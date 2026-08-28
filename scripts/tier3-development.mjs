#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { closeTier3BrowserProxy, createTier3BrowserProxy } from "./tier3-browser-proxy.mjs";
import { createTier3SessionConfiguration, parseTier3Arguments, TIER3_DEVELOPMENT_HELP } from "./tier3-development-options.mjs";
import { readTier3IngressCertificate } from "./tier3-ingress-certificate.mjs";
import { resolveTier3ModelProvider } from "./tier3-model-provider.mjs";

const _SMOKE_PATH = "apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh";
const _REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Qualifies a full disposable silo and optionally exposes its ingress to a local browser.
 *
 * The proxy starts only after the existing smoke reports success, so a forwarded Codespaces URL
 * cannot make a partially installed cluster look ready. Stopping the proxy leaves the cluster
 * intact for the diagnosis promised by this workflow.
 *
 * Called by: this file's command entrypoint after argument parsing.
 *
 * @param {{ model?: string, profile: "agent" | "infrastructure", provider?: string, proxyPort: number, smokeOnly: boolean, storageMode: "fast" | "full" }} options - Reviewed Tier 3 command options.
 * @param {object} operations - Process boundaries replaced by orchestration tests.
 * @param {Function} [operations.createProxy] - Creates a stopped ingress proxy.
 * @param {Function} [operations.listenProxy] - Binds that proxy to a loopback port.
 * @param {NodeJS.ProcessEnv} [operations.parentEnvironment] - Supplies smoke identity and process inputs.
 * @param {Function} [operations.readIngressCertificate] - Reads the smoke-issued ingress certificate.
 * @param {Function} [operations.resolveModelProvider] - Resolves the reviewed provider/model and one credential.
 * @param {Function} [operations.runSmoke] - Runs the app-owned k3d qualification.
 * @param {Function} [operations.waitForShutdown] - Keeps the proxy alive for inspection.
 * @param {Function} [operations.writeOutput] - Reports the ready session.
 * @returns {Promise<void>} Resolves when smoke-only completes or the developer stops the proxy.
 * @throws {Error} When smoke, certificate lookup, proxy validation, or the loopback listener fails.
 */
export async function runTier3Development(options, operations = {})
{
	const parentEnvironment = operations.parentEnvironment ?? process.env;
	const resolveModelProvider = operations.resolveModelProvider ?? resolveTier3ModelProvider;
	let modelProvider;
	try
	{
		modelProvider = resolveModelProvider(options, parentEnvironment, _REPOSITORY_ROOT);
	}
	finally
	{
		delete parentEnvironment.OPENCRANE_TIER3_PROVIDER_API_KEY;
	}
	const configuration = createTier3SessionConfiguration(parentEnvironment, options.storageMode, modelProvider);
	const runSmoke = operations.runSmoke ?? _RunSmoke;
	const createProxy = operations.createProxy ?? createTier3BrowserProxy;
	const listenProxy = operations.listenProxy ?? _ListenProxy;
	const readIngressCertificate = operations.readIngressCertificate ?? readTier3IngressCertificate;
	const waitForShutdown = operations.waitForShutdown ?? _WaitForShutdown;
	const writeOutput = operations.writeOutput ?? function _write(message) { process.stdout.write(message); };
	let smokeRun;
	try
	{
		smokeRun = runSmoke(configuration.smokeEnvironment);
	}
	finally
	{
		delete configuration.smokeEnvironment.OPENCRANE_TIER3_PROVIDER_API_KEY;
		if (modelProvider)
		{
			modelProvider.apiKey = "";
		}
	}
	await smokeRun;

	if (options.smokeOnly)
	{
		return;
	}

	const upstreamCertificate = await readIngressCertificate(configuration.ingressCertificate);
	const server = createProxy({ proxySecret: configuration.proxySecret, upstreamCertificate, upstreamHost: configuration.upstreamHost });
	await listenProxy(server, options.proxyPort);

	writeOutput(`\nTier 3 is ready on http://127.0.0.1:${options.proxyPort}.\n`);
	if (modelProvider)
	{
		writeOutput(`Personal-agent onboarding uses ${modelProvider.provider} with ${modelProvider.model}.\n`);
	}
	else
	{
		writeOutput("This credential-free profile qualifies infrastructure; personal-agent onboarding cannot conclude.\n");
	}
	writeOutput("In Codespaces, open the forwarded port with the 'OpenCrane Tier 3' label.\n");
	writeOutput("The k3d cluster remains available after this command stops.\n");
	await waitForShutdown(server);
}

/** Runs the existing app-owned smoke without copying its deployment logic. */
function _RunSmoke(smokeEnvironment)
{
	return new Promise(function _wait(resolve, reject)
	{
		const child = spawn("bash", [_SMOKE_PATH], {
			cwd: _REPOSITORY_ROOT,
			env: smokeEnvironment,
			stdio: "inherit"
		});
		child.once("error", reject);
		child.once("close", function _finished(code, signal)
		{
			if (code === 0)
			{
				resolve();
				return;
			}

			reject(new Error(`Tier 3 smoke stopped before qualification (${signal ?? `exit ${code}`}).`));
		});
	});
}

/** Binds the browser proxy to the loopback interface forwarded by Codespaces. */
function _ListenProxy(server, proxyPort)
{
	return new Promise(function _listen(resolve, reject)
	{
		server.once("error", reject);
		server.listen(proxyPort, "127.0.0.1", resolve);
	});
}

/** Keeps the browser proxy alive until the developer ends the session. */
function _WaitForShutdown(server)
{
	return new Promise(function _wait(resolve, reject)
	{
		let stopping = false;

		function _stop()
		{
			if (stopping)
			{
				return;
			}

			stopping = true;
			closeTier3BrowserProxy(server).then(resolve, reject);
		}

		process.once("SIGINT", _stop);
		process.once("SIGTERM", _stop);
	});
}

async function _main()
{
	const options = parseTier3Arguments(process.argv.slice(2));

	if (options.help)
	{
		process.stdout.write(TIER3_DEVELOPMENT_HELP);
		return;
	}

	await runTier3Development(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	_main().catch(function _reportFailure(error)
	{
		process.stderr.write(`Tier 3 development failed: ${error.message}\n`);
		process.exitCode = 1;
	});
}
