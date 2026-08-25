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

/** Builds a child environment from reviewed toolchain variables and an explicit process contract. */
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

/** Returns the server allowlist without the seed private key or controller-only configuration. */
export function createOpenCraneServerProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _serverEntry([name])
	{
		return name === "DATABASE_URL"
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

/** Returns the controller allowlist without database credentials or membership signing material. */
export function createAgentControllerProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _controllerEntry([name])
	{
		return name === "OPENCRANE_DEVELOPMENT_PROFILE"
			|| name === "LITELLM_ENDPOINT"
			|| name === "OPENCRANE_INTERNAL_URL"
			|| name === "OPENCRANE_LOCAL_RUNTIME_PYTHON"
			|| name === "OPENCRANE_CONTROLLER_TOKEN_PATH"
			|| name === "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH"
			|| name === "OPENCRANE_REPOSITORY_ROOT"
			|| name === "AGENT_CONTROLLER_PROFILES_JSON";
	}));
}

/** Returns the seed allowlist containing its database URL and temporary membership keypair. */
export function createDevelopmentSeedProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _seedEntry([name])
	{
		return name === "DATABASE_URL"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH";
	}));
}
