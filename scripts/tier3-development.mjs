#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { closeTier3BrowserProxy, createTier3BrowserProxy, tier3BrowserOrigins } from "./tier3-development/browser-proxy.mjs";
import { runTier3AgentJourney } from "./tier3-development/agent-journey.mjs";
import { classifyTier3Capacity, formatTier3Capacity, measureTier3Capacity } from "./tier3-development/host-capacity.mjs";
import { readTier3IngressCertificate } from "./tier3-development/ingress-certificate.mjs";
import { parseTier3Options, TIER3_HELP } from "./tier3-development/options.mjs";
import { prepareTier3ProviderCredentials } from "./tier3-development/provider-credentials.mjs";
import { assertTier3ResourceReplacement, inspectTier3Resources, tier3ResourceIdentity } from "./tier3-development/resource-ownership.mjs";

const _REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const _SMOKE_PATH = "apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh";

/**
 * Qualifies the current k3d silo before opening its certificate-pinned loopback browser route.
 * Agent mode then completes the product journey, and closes the proxy if that proof fails so the
 * command cannot leave a listener running after it reports failure.
 * @returns The worktree resource identity and the profile that completed.
 * @throws When capacity, ownership, cluster qualification, proxy startup, or Agent proof fails.
 */
export async function runTier3Development(options, operations = {})
{
	const write = operations.write ?? function _Write(message) { process.stdout.write(message); };
	const environment = operations.environment ?? process.env;
	const providerCredentials = await (operations.prepareProviderCredentials ?? prepareTier3ProviderCredentials)(options, environment);
	const allowedBrowserOrigins = options.smokeOnly ? null : tier3BrowserOrigins(options.proxyPort, environment);
	const capacity = classifyTier3Capacity(await (operations.measureCapacity ?? measureTier3Capacity)());
	write(`${formatTier3Capacity(capacity)}\n`);
	if (capacity.minimumShortfalls.length) throw new Error(`Tier 3 minimum is not met: ${capacity.minimumShortfalls.join(", ")}. No caches, clusters, or images were deleted.`);
	if (capacity.recommendedShortfalls.length) write(`Tier 3 recommendation not met: ${capacity.recommendedShortfalls.join(", ")}. The minimum profile remains supported.\n`);
	const identity = tier3ResourceIdentity(_REPOSITORY_ROOT);
	const resources = await (operations.inspectResources ?? inspectTier3Resources)(identity);
	assertTier3ResourceReplacement(resources.existingOwner, identity.owner, options.replaceOwned);
	const smokeEnvironment = {
		...environment,
		BASE_DOMAIN: "local.opencrane.test",
		CLUSTER_NAME: identity.clusterName,
		CLUSTER_TENANT: identity.clusterTenant,
		KEEP_CLUSTER: "1",
		NAMESPACE: identity.namespace,
		RELEASE_NAME: identity.releaseName,
		SMOKE_HOST_PROFILE: environment.SMOKE_HOST_PROFILE || "minimum",
		SMOKE_INGRESS_PORT: String(identity.ingressPort),
		SMOKE_INSTALL_TIMEOUT_SECONDS: environment.SMOKE_INSTALL_TIMEOUT_SECONDS || "1800",
		SMOKE_PREREQUISITE_TIMEOUT_SECONDS: environment.SMOKE_PREREQUISITE_TIMEOUT_SECONDS || "1800",
		SMOKE_RESOURCE_OWNER: identity.owner,
		SMOKE_STORAGE_MODE: options.storageMode,
		TIMEOUT_SECONDS: environment.TIMEOUT_SECONDS || "600"
	};
	const developmentCredential = options.profile === "agent" ? randomBytes(32).toString("base64url") : null;
	if (developmentCredential !== null) smokeEnvironment.OPENCRANE_K3D_DEVELOPMENT_CREDENTIAL = developmentCredential;
	await (operations.runSmoke ?? _RunSmoke)(smokeEnvironment);
	if (options.smokeOnly) return { identity, profile: options.profile };
	const upstreamCertificate = await (operations.readCertificate ?? readTier3IngressCertificate)({ certificateName: `${identity.releaseName}-clustertenant-tls`, namespace: identity.namespace });
	const upstreamHost = `${identity.clusterTenant}.local.opencrane.test`;
	const proxyOptions = {
		allowedBrowserOrigins,
		developmentCredential,
		upstreamCertificate,
		upstreamHost,
		upstreamOrigin: `https://127.0.0.1:${identity.ingressPort}`,
	};
	const server = (operations.createProxy ?? createTier3BrowserProxy)(proxyOptions);
	await (operations.listenProxy ?? _ListenProxy)(server, options.proxyPort);
	write(`Tier 3 ${options.profile} is ready on http://127.0.0.1:${options.proxyPort}.\n`);
	write("Keep the Codespaces forwarded port private. The owned k3d cluster remains available for diagnosis.\n");
	try
	{
		if (options.profile === "agent")
		{
			const agentJourneyInput = {
				credential: developmentCredential,
				origin: `http://127.0.0.1:${options.proxyPort}`,
				...providerCredentials
			};
			await (operations.runAgentJourney ?? runTier3AgentJourney)(agentJourneyInput);
		}

		await (operations.waitForShutdown ?? _WaitForShutdown)(server);
	}
	catch (error)
	{
		await (operations.closeProxy ?? closeTier3BrowserProxy)(server);
		throw error;
	}
	return { identity, profile: options.profile };
}

function _RunSmoke(environment) { return new Promise(function _Wait(resolve, reject) { const child = spawn("bash", [_SMOKE_PATH], { cwd: _REPOSITORY_ROOT, env: environment, stdio: "inherit" }); child.once("error", reject); child.once("close", function _Finished(code, signal) { if (code === 0) resolve(); else reject(new Error(`Tier 3 smoke stopped before qualification (${signal ?? `exit ${code}`}).`)); }); }); }
function _ListenProxy(server, port) { return new Promise(function _Listen(resolve, reject) { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); }
function _WaitForShutdown(server) { return new Promise(function _Wait(resolve, reject) { let stopping = false; function _Stop() { if (stopping) return; stopping = true; closeTier3BrowserProxy(server).then(resolve, reject); } process.once("SIGINT", _Stop); process.once("SIGTERM", _Stop); }); }

async function _Main() { const options = parseTier3Options(process.argv.slice(2)); if (options.help) { process.stdout.write(TIER3_HELP); return; } await runTier3Development(options); }
if (process.argv[1] === fileURLToPath(import.meta.url)) _Main().catch(function _Failure(error) { process.stderr.write(`Tier 3 development failed: ${error.message}\n`); process.exitCode = 1; });
