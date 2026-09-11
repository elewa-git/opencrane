import { createDockerLabelArguments } from "./docker-resources.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

/** Builds the exact-owned PostgreSQL container for the current release operand. */
export function createPostgresCommand(configuration, secrets)
{
	return {
		command: "docker",
		arguments: [
			"run", "--detach", "--name", configuration.postgresContainerName,
			...createDockerLabelArguments(configuration),
			"--network", configuration.networkName,
			"--publish", `127.0.0.1:${configuration.postgresPort}:5432`,
			"--mount", `type=volume,source=${configuration.postgresVolumeName},target=/var/lib/postgresql/data`,
			"--env", "POSTGRES_USER", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB",
			configuration.postgresImage
		],
		environment: { POSTGRES_USER: "opencrane", POSTGRES_PASSWORD: secrets.postgresPassword, POSTGRES_DB: "opencrane" }
	};
}

/** Builds the secure exact-owned KurrentDB container used by the production TLS adapter. */
export function createKurrentCommand(configuration, secrets)
{
	return {
		command: "docker",
		arguments: [
			"run", "--detach", "--name", configuration.kurrentContainerName,
			...createDockerLabelArguments(configuration),
			"--network", configuration.networkName,
			"--publish", `127.0.0.1:${configuration.kurrentPort}:2113`,
			"--mount", `type=volume,source=${configuration.kurrentVolumeName},target=/var/lib/kurrentdb`,
			"--mount", `type=volume,source=${configuration.kurrentTlsVolumeName},target=/var/run/opencrane/local-tls,readonly`,
			"--env", "KURRENTDB_CLUSTER_SIZE=1",
			"--env", "KURRENTDB_INSECURE=false",
			"--env", "KURRENTDB_ALLOW_ANONYMOUS_STREAM_ACCESS=false",
			"--env", "KURRENTDB_ALLOW_ANONYMOUS_ENDPOINT_ACCESS=false",
			"--env", "KURRENTDB_ENABLE_ATOM_PUB_OVER_HTTP=true",
			"--env", "KURRENTDB_NODE_PORT=2113",
			"--env", "KURRENTDB_CERTIFICATE_FILE=/var/run/opencrane/local-tls/node/tls.crt",
			"--env", "KURRENTDB_CERTIFICATE_PRIVATE_KEY_FILE=/var/run/opencrane/local-tls/node/tls.key",
			"--env", "KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH=/var/run/opencrane/local-tls/ca",
			"--env", "KURRENTDB_DEFAULT_ADMIN_PASSWORD",
			"--env", "KURRENTDB_DEFAULT_OPS_PASSWORD",
			configuration.kurrentImage
		],
		environment: { KURRENTDB_DEFAULT_ADMIN_PASSWORD: secrets.kurrentAdminPassword, KURRENTDB_DEFAULT_OPS_PASSWORD: secrets.kurrentOpsPassword }
	};
}

/** Copies owner-only host TLS material into a UID-scoped Docker volume. */
export function createKurrentTlsVolumeCommand(configuration, secrets)
{
	const install = "set -eu; rm -rf /target/node /target/ca; mkdir -p /target/node /target/ca; cp /source/kurrentdb.crt /target/node/tls.crt; cp /source/kurrentdb.key /target/node/tls.key; cp /source/kurrentdb-ca.crt /target/ca/ca.crt; chown -R 1001:1001 /target/node /target/ca; chmod 0700 /target/node /target/ca; chmod 0600 /target/node/tls.key; chmod 0644 /target/node/tls.crt /target/ca/ca.crt";
	return {
		command: "docker",
		arguments: [
			"run", "--rm", "--name", configuration.kurrentTlsProvisionerContainerName,
			...createDockerLabelArguments(configuration),
			"--network", "none", "--user", "0:0",
			"--mount", `type=bind,source=${secrets.directory},target=/source,readonly`,
			"--mount", `type=volume,source=${configuration.kurrentTlsVolumeName},target=/target`,
			"--entrypoint", "/bin/sh", configuration.kurrentImage, "-c", install
		],
		environment: {}
	};
}

/** Builds the optional local LiteLLM container from the reviewed generated configuration. */
export function createLiteLLMCommand(configuration, secrets, provider)
{
	return {
		command: "docker",
		arguments: [
			"run", "--detach", "--name", configuration.liteLLMContainerName,
			...createDockerLabelArguments(configuration),
			"--network", configuration.networkName,
			"--publish", `127.0.0.1:${configuration.liteLLMPort}:4000`,
			"--mount", `type=bind,source=${provider.generatedConfigPath},target=/app/config.yaml,readonly`,
			"--env", provider.providerKeyEnvironmentVariable,
			"--env", "LITELLM_MASTER_KEY",
			configuration.liteLLMImage,
			"--config", "/app/config.yaml", "--port", "4000"
		],
		environment: { [provider.providerKeyEnvironmentVariable]: provider.providerKey, LITELLM_MASTER_KEY: secrets.liteLLMMasterKey }
	};
}

/** Builds the current server and live-gateway Angular UI process group. */
export function createApplicationCommands(configuration, secrets)
{
	const serverEnvironment = {
		NODE_ENV: "development",
		OPENCRANE_LOCAL_DEVELOPMENT: "true",
		OPENCRANE_LOCAL_DEVELOPMENT_PROFILE: configuration.developmentProfile,
		OPENCRANE_LOCAL_BROWSER_SESSION_CREDENTIAL_PATH: secrets.browserSessionCredentialPath,
		DATABASE_URL: `postgresql://opencrane:${encodeURIComponent(secrets.postgresPassword)}@127.0.0.1:${configuration.postgresPort}/opencrane`,
		OPENCRANE_LOCAL_KURRENTDB_ENDPOINT: `127.0.0.1:${configuration.kurrentPort}`,
		OPENCRANE_LOCAL_KURRENTDB_CA_PATH: secrets.caCertificatePath,
		OPENCRANE_LOCAL_KURRENTDB_USERNAME_PATH: secrets.kurrentHistoryUsernamePath,
		OPENCRANE_LOCAL_KURRENTDB_PASSWORD_PATH: secrets.kurrentHistoryPasswordPath,
		OPENCRANE_LOCAL_CONVERSATION_KEYRING_PATH: secrets.conversationKeyringPath,
		OPENCRANE_LOCAL_INVITATION_SIGNING_KEY_PATH: secrets.invitationSigningKeyPath,
		PORT: String(configuration.publicPort),
		INTERNAL_PORT: String(configuration.internalPort)
	};
	if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		serverEnvironment.LITELLM_ENDPOINT = `http://127.0.0.1:${configuration.liteLLMPort}`;
		serverEnvironment.LITELLM_MASTER_KEY = secrets.liteLLMMasterKey;
	}
	if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
	{
		serverEnvironment.LITELLM_ENDPOINT = configuration.remoteLiteLLMEndpoint;
		serverEnvironment.LITELLM_MASTER_KEY = secrets.liteLLMMasterKey;
	}
	return [
		{ name: "opencrane-server", command: "npx", arguments: ["tsx", "apps/opencrane/src/development/index.ts"], environment: serverEnvironment },
		{ name: "opencrane-ui", command: "npx", arguments: ["nx", "serve", "opencrane-ui", "--configuration=tier2", "--host=local-development.localhost", `--port=${configuration.uiPort}`, "--output-style=stream"], environment: { NX_TUI: "false", NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false" } }
	];
}
