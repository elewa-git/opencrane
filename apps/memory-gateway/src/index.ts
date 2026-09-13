import "./instrument";

import * as k8s from "@kubernetes/client-node";
import { __CreateCogneeProviderCredentialFileReader, __CreateCogneeProviderSession, __CreateMemoryGatewayServer } from "@opencrane/backend/memory-gateway";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import { _CreateMemoryGatewayServerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import { _ReadConfig } from "./config";
import { _log } from "./log";

/** Largest provider response the private gateway will retain for one bounded operation. */
const _MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

/** Start the private memory gateway and drain it before telemetry shuts down. */
function _Main(): void
{
	const unbindConsole = ___BindConsole(_log);
	const config = _ReadConfig();
	const kubeConfig = new k8s.KubeConfig();
	kubeConfig.loadFromDefault();
	const tokenReviewer = _CreateMemoryGatewayServerTokenReviewer(kubeConfig.makeApiClient(k8s.AuthenticationV1Api), { audience: config.serverTokenAudience, namespace: config.namespace, serviceAccountName: config.serverServiceAccountName });
	const credentialReader = __CreateCogneeProviderCredentialFileReader({ emailPath: config.cogneeCredentialEmailPath, passwordPath: config.cogneeCredentialPasswordPath });
	const providerSession = __CreateCogneeProviderSession({ baseUrl: config.cogneeUrl, credentialReader, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, maximumResponseBytes: _MAX_PROVIDER_RESPONSE_BYTES, allowFirstInstallRegistration: config.allowFirstInstallRegistration });
	const server = __CreateMemoryGatewayServer({ tokenReviewer, providerSession, log: _log });
	server.listen(config.port, function _listening()
	{
		_log.info({ port: config.port }, "memory gateway listening");
	});
	for (const signal of ["SIGTERM", "SIGINT"] as const)
	{
		process.once(signal, function _shutdown()
		{
			server.close(function _closed()
			{
				unbindConsole();
				void ___ShutdownTelemetry().finally(function _exit() { process.exit(0); });
			});
		});
	}
}

_Main();
