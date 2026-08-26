import { LOCAL_DEVELOPMENT_ALTERNATIVES, LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";
import { createAgentControllerEnvironment } from "./agent-controller-environment.mjs";
import { createAgentControllerProcessEnvironment, createOpenCraneServerProcessEnvironment } from "./process-environments.mjs";

const _OWNER_LABEL = "opencrane.local-development.owner=opencrane";
const _POSTGRES_IMAGE = "postgres@sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449";
const _LITELLM_IMAGE = "ghcr.io/berriai/litellm-non_root@sha256:39718a9cc9138c99ec812bcde24896411cf54502967a36b19897c539b796fdc7";
/** Prevents child task runners from changing the foreground terminal's mode while the launcher handles shutdown. */
const _NX_COORDINATED_PROCESS_ENVIRONMENT = Object.freeze({
	NX_NATIVE_COMMAND_RUNNER: "false",
	NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
	NX_TUI: "false"
});

/** Builds the labelled, loopback-bound PostgreSQL container command used by the coordinator. */
export function createPostgresRunCommand(configuration, secrets)
{
	return {
		command: "docker",
		arguments: [
			"run",
			"--detach",
			"--name",
			configuration.postgresContainerName,
			"--label",
			_OWNER_LABEL,
			"--publish",
			`127.0.0.1:${configuration.postgresPort}:5432`,
			"--mount",
			`type=volume,source=${configuration.postgresVolumeName},target=/var/lib/postgresql/data`,
			"--env",
			"POSTGRES_USER",
			"--env",
			"POSTGRES_PASSWORD",
			"--env",
			"POSTGRES_DB",
			_POSTGRES_IMAGE
		],
		environment: {
			POSTGRES_USER: "opencrane",
			POSTGRES_PASSWORD: secrets.postgresPassword,
			POSTGRES_DB: "opencrane"
		}
	};
}

/** Returns the local LiteLLM container command for Alternative A, or no command for the other profiles. */
export function createLiteLLMRunCommand(configuration, secrets)
{
	if (configuration.alternative !== LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		return undefined;
	}

	return {
		command: "docker",
		arguments: [
			"run",
			"--detach",
			"--name",
			configuration.liteLLMContainerName,
			"--label",
			_OWNER_LABEL,
			"--network",
			configuration.localNetworkName,
			"--publish",
			`127.0.0.1:${configuration.liteLLMPort}:4000`,
			"--mount",
			`type=bind,source=${configuration.liteLLMConfigPath},target=/app/opencrane-local.yaml,readonly`,
			"--env",
			"LITELLM_MASTER_KEY",
			"--env",
			"OPENAI_API_KEY",
			"--env",
			"DATABASE_URL",
			_LITELLM_IMAGE,
			"--config",
			"/app/opencrane-local.yaml",
			"--port",
			"4000"
		],
		environment: {
			LITELLM_MASTER_KEY: secrets.liteLLMMasterKey,
			OPENAI_API_KEY: secrets.providerKey,
			DATABASE_URL: `postgresql://opencrane:${secrets.postgresPassword}@${configuration.postgresContainerName}:5432/litellm`
		}
	};
}

/** Builds the shared application variables before each process receives its smaller allowlist. */
export function createApplicationEnvironment(configuration, secrets, developmentCredentials)
{
	const baseEnvironment = {
		...createAgentControllerEnvironment(configuration, developmentCredentials),
		OPENCRANE_DEVELOPMENT_ENTRYPOINT: "true",
		OPENCRANE_DEVELOPMENT_PROFILE: configuration.developmentProfile,
		OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH: developmentCredentials.privateKeyPath,
		OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH: developmentCredentials.publicKeyPath,
		PORT: String(configuration.publicPort),
		INTERNAL_PORT: String(configuration.internalPort),
		DATABASE_URL: `postgresql://opencrane:${secrets.postgresPassword}@127.0.0.1:${configuration.postgresPort}/opencrane`
	};

	if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		baseEnvironment.LITELLM_ENDPOINT = `http://127.0.0.1:${configuration.liteLLMPort}`;
		baseEnvironment.LITELLM_MASTER_KEY = secrets.liteLLMMasterKey;
	}
	else if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
	{
		baseEnvironment.LITELLM_ENDPOINT = configuration.remoteLiteLLMEndpoint;
		baseEnvironment.LITELLM_MASTER_KEY = secrets.liteLLMMasterKey;
	}

	return baseEnvironment;
}

/**
 * Builds the watched process specifications for the selected Tier 2 profile.
 * Core starts the server and UI, while Agent profiles also start the controller. Child task runners
 * use stream output and avoid terminal modes because the foreground launcher owns shutdown signals.
 *
 * Called by: `runLocalDevelopmentSession` after the database seed and any LiteLLM readiness check.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Selected Tier 2 composition and listener ports.
 * @param {Record<string, string>} applicationEnvironment - Variables admitted for this local application session.
 * @returns {readonly object[]} Process specifications in server, optional controller, then UI order.
 */
export function createApplicationCommands(configuration, applicationEnvironment)
{
	const controllerEnvironment = createAgentControllerProcessEnvironment(applicationEnvironment);
	const serverEnvironment = createOpenCraneServerProcessEnvironment(applicationEnvironment);
	const commands = [
		{
			name: "server",
			command: "npm",
			arguments: ["run", "dev:tier2", "-w", "@opencrane/server"],
			environment: serverEnvironment
		}
	];

	if (configuration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		commands.push({
			name: "agent-controller",
			command: "npx",
			arguments: ["nx", "run", "agent-controller:dev-tier2", "--output-style=stream"],
			environment: {
				...controllerEnvironment,
				..._NX_COORDINATED_PROCESS_ENVIRONMENT
			}
		});
	}

	commands.push({
		name: "opencrane-ui",
		command: "npx",
		arguments: ["nx", "serve", "opencrane-ui", "--configuration=development-live", "--port", String(configuration.uiPort), "--output-style=stream"],
		environment: _NX_COORDINATED_PROCESS_ENVIRONMENT
	});

	return commands;
}
