import { LOCAL_DEVELOPMENT_ALTERNATIVES, LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";
import { createAgentControllerEnvironment } from "./agent-controller-environment.mjs";
import { createAgentControllerProcessEnvironment } from "./process-environments.mjs";

const _OWNER_LABEL = "opencrane.local-development.owner=opencrane";
const _POSTGRES_IMAGE = "postgres:17";
const _LITELLM_IMAGE = "ghcr.io/berriai/litellm-non_root:main-v1.81.0-stable";

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
			"--publish",
			`127.0.0.1:${configuration.liteLLMPort}:4000`,
			"--mount",
			`type=bind,source=${configuration.liteLLMConfigPath},target=/app/opencrane-local.yaml,readonly`,
			"--env",
			"LITELLM_MASTER_KEY",
			"--env",
			"OPENAI_API_KEY",
			_LITELLM_IMAGE,
			"--config",
			"/app/opencrane-local.yaml",
			"--port",
			"4000"
		],
		environment: {
			LITELLM_MASTER_KEY: secrets.liteLLMMasterKey,
			OPENAI_API_KEY: secrets.providerKey
		}
	};
}

export function createApplicationEnvironment(configuration, secrets, developmentCredentials)
{
	const baseEnvironment = {
		...createAgentControllerEnvironment(configuration, developmentCredentials),
		OPENCRANE_DEVELOPMENT_ENTRYPOINT: "true",
		OPENCRANE_DEVELOPMENT_PROFILE: configuration.developmentProfile,
		OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH: developmentCredentials.privateKeyPath,
		OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH: developmentCredentials.publicKeyPath,
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

export function createApplicationCommands(configuration, applicationEnvironment)
{
	const controllerEnvironment = createAgentControllerProcessEnvironment(applicationEnvironment);
	const commands = [
		{
			name: "server",
			command: "npm",
			arguments: ["run", "dev:tier2", "-w", "@opencrane/server"],
			environment: applicationEnvironment
		}
	];

	if (configuration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		commands.push({
			name: "agent-controller",
			command: "npx",
			arguments: ["nx", "run", "agent-controller:dev-tier2"],
			environment: controllerEnvironment
		});
	}

	commands.push({
		name: "opencrane-ui",
		command: "npx",
		arguments: ["nx", "serve", "opencrane-ui", "--configuration=development-live"]
	});

	return commands;
}
