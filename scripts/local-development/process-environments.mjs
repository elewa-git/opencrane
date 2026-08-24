export function createAgentControllerProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _controllerEntry([name])
	{
		return name === "OPENCRANE_DEVELOPMENT_PROFILE"
			|| name === "LITELLM_ENDPOINT"
			|| name === "OPENCRANE_INTERNAL_URL"
			|| name === "OPENCRANE_CONTROLLER_TOKEN_PATH"
			|| name === "OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH"
			|| name === "OPENCRANE_REPOSITORY_ROOT"
			|| name === "AGENT_CONTROLLER_PROFILES_JSON";
	}));
}

export function createDevelopmentSeedProcessEnvironment(applicationEnvironment)
{
	return Object.fromEntries(Object.entries(applicationEnvironment).filter(function _seedEntry([name])
	{
		return name === "DATABASE_URL"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH"
			|| name === "OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH";
	}));
}
