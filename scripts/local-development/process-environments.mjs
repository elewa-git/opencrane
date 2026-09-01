/** Parent variables required to find tools and preserve terminal behavior without forwarding credentials. */
const _TOOLCHAIN_ENVIRONMENT_NAMES = [
	"COLORTERM",
	"DOCKER_CERT_PATH",
	"DOCKER_CONTEXT",
	"DOCKER_HOST",
	"DOCKER_TLS_VERIFY",
	"FORCE_COLOR",
	"HOME",
	"LANG",
	"LC_ALL",
	"NO_COLOR",
	"PATH",
	"SHELL",
	"TERM",
	"TMPDIR"
];

/**
 * Builds a child environment from reviewed toolchain variables and an explicit process contract.
 * Parent credentials are omitted unless the selected profile adds a value deliberately.
 *
 * Called by: the command runner and process supervisor before spawning any Tier 2 child.
 * @param {NodeJS.ProcessEnv} parentEnvironment - Developer shell environment to filter.
 * @param {Record<string, string>} processEnvironment - Variables owned by the selected child.
 * @returns A fresh environment containing the toolchain allowlist and child-specific values.
 */
export function createToolchainProcessEnvironment(parentEnvironment, processEnvironment = {})
{
	const toolchainEnvironment = Object.fromEntries(_TOOLCHAIN_ENVIRONMENT_NAMES.flatMap(function _AllowedName(name)
	{
		const value = parentEnvironment[name];
		return typeof value === "string" ? [[name, value]] : [];
	}));

	return {
		...toolchainEnvironment,
		...processEnvironment
	};
}

/**
 * Returns the server allowlist without the seed private key or controller-only configuration.
 * Called by: `createApplicationCommands` before starting the watched OpenCrane server.
 * @param {Record<string, string>} applicationEnvironment - Coordinator-owned shared variables.
 * @returns Variables admitted to the server process.
 */
export function createOpenCraneServerProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _serverEntry([name])
	{
		return name === "DATABASE_URL"
			|| name === "AGENT_RUNTIME_CONTINUATION_KEYRING_PATH"
			|| name === "INTERNAL_PORT"
			|| name === "LITELLM_ENDPOINT"
			|| name === "LITELLM_MASTER_KEY"
			|| name === "OPENCRANE_CONTROLLER_TOKEN_PATH"
			|| name === "OPENCRANE_DEVELOPMENT_ENTRYPOINT"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH"
			|| name === "OPENCRANE_DEVELOPMENT_PROFILE"
			|| name === "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH"
			|| name === "PORT";
	}));
}

/**
 * Returns the controller allowlist without membership signing material or the runtime continuation keyring.
 * Called by: `createApplicationCommands` before starting the Agent controller.
 * @param {Record<string, string>} applicationEnvironment - Coordinator-owned shared variables.
 * @returns Variables admitted to the controller process.
 */
export function createAgentControllerProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _controllerEntry([name])
	{
		return name === "DATABASE_URL"
			|| name === "OPENCRANE_DEVELOPMENT_PROFILE"
			|| name === "LITELLM_ENDPOINT"
			|| name === "OPENCRANE_INTERNAL_URL"
			|| name === "OPENCRANE_LOCAL_RUNTIME_PYTHON"
			|| name === "OPENCRANE_CONTROLLER_TOKEN_PATH"
			|| name === "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH"
			|| name === "OPENCRANE_REPOSITORY_ROOT"
			|| name === "OPENCRANE_SERVER_SERVICE_NAME"
			|| name === "OPENCRANE_SERVER_NAMESPACE"
			|| name === "OPENCRANE_SILO_ID"
			|| name === "AGENT_CONTROLLER_WARM_PROFILES_JSON";
	}));
}

/**
 * Returns the seed allowlist containing its database URL and temporary membership keypair.
 * Called by: `createDevelopmentSeedCommand` for the replay-safe seed subprocess.
 * @param {Record<string, string>} applicationEnvironment - Coordinator-owned shared variables.
 * @returns Variables admitted to the database seed process.
 */
export function createDevelopmentSeedProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _seedEntry([name])
	{
		return name === "DATABASE_URL"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH";
	}));
}
