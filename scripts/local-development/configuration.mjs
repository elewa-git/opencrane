import path from "node:path";
import { LOCAL_DEVELOPMENT_ALTERNATIVES, LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";

const _DEVELOPMENT_PROFILE_BY_ALTERNATIVE = Object.freeze({
	[LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM]: "agent-local",
	[LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM]: "agent-remote",
	[LOCAL_DEVELOPMENT_ALTERNATIVES.Simulated]: "agent-simulated"
});

export function createLocalDevelopmentConfiguration(parsed, repositoryRoot, environment = process.env)
{
	const publicPort = 8_080;
	const internalPort = 8_081;
	const postgresPort = Number(environment.OPENCRANE_LOCAL_POSTGRES_PORT ?? "54329");
	const liteLLMPort = Number(environment.OPENCRANE_LOCAL_LITELLM_PORT ?? "4000");

	if (!Number.isInteger(postgresPort) || postgresPort < 1024 || postgresPort > 65535)
	{
		throw new Error("OPENCRANE_LOCAL_POSTGRES_PORT must be an integer from 1024 to 65535");
	}

	if (!Number.isInteger(liteLLMPort) || liteLLMPort < 1024 || liteLLMPort > 65535)
	{
		throw new Error("OPENCRANE_LOCAL_LITELLM_PORT must be an integer from 1024 to 65535");
	}

	if (postgresPort === liteLLMPort && parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		throw new Error("PostgreSQL and local LiteLLM must use different host ports");
	}

	if ([publicPort, internalPort].includes(postgresPort))
	{
		throw new Error("PostgreSQL must not use the OpenCrane public or internal host port");
	}

	if (parsed.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM && [publicPort, internalPort].includes(liteLLMPort))
	{
		throw new Error("Local LiteLLM must not use the OpenCrane public or internal host port");
	}

	const developmentProfile = parsed.profile === LOCAL_DEVELOPMENT_PROFILES.Core
		? LOCAL_DEVELOPMENT_PROFILES.Core
		: _DEVELOPMENT_PROFILE_BY_ALTERNATIVE[parsed.alternative];

	const runtimeVirtualEnvironmentPath = path.join(repositoryRoot, "apps/agent-runtime/.venv");

	return {
		profile: parsed.profile,
		alternative: parsed.alternative,
		remoteLiteLLMEndpoint: parsed.remoteLiteLLMEndpoint,
		reset: parsed.reset,
		developmentProfile,
		repositoryRoot,
		publicPort,
		internalPort,
		postgresPort,
		liteLLMPort,
		postgresContainerName: "opencrane-local-postgres",
		postgresVolumeName: "opencrane-local-postgres-data",
		localNetworkName: "opencrane-local-development",
		liteLLMContainerName: "opencrane-local-litellm",
		baselinePath: path.join(repositoryRoot, "apps/opencrane/prisma/bootstrap/target-baseline.sql"),
		seedPath: path.join(repositoryRoot, "apps/postgres/scripts/local-development-seed.sql"),
		liteLLMConfigPath: path.join(repositoryRoot, "apps/_infra/litellm/local-development/config.yaml"),
		providerKeyPath: path.join(repositoryRoot, "keys/.openai-key"),
		localLiteLLMMasterKeyPath: path.join(repositoryRoot, "keys/.litellm-master-key"),
		remoteLiteLLMMasterKeyPath: parsed.remoteLiteLLMMasterKeyFile
			? path.resolve(repositoryRoot, parsed.remoteLiteLLMMasterKeyFile)
			: undefined,
		runtimeVirtualEnvironmentPath,
		runtimePythonPath: path.join(runtimeVirtualEnvironmentPath, "bin/python"),
		runtimeRequirementsPath: path.join(repositoryRoot, "apps/agent-runtime/deploy/requirements.txt"),
		runtimeRequirementsStampPath: path.join(runtimeVirtualEnvironmentPath, ".opencrane-requirements.sha256")
	};
}
