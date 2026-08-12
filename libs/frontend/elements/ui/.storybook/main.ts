import type { StorybookConfig } from "@storybook/angular";

/** Storybook catalogue configuration for shared OpenCrane UI elements. */
const config: StorybookConfig =
{
	stories:
	[
		"../src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../a2ui/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/onboarding/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/context/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/conversation-assets/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/conversation-activity/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/conversation-elicitation/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)"
		,"../../conversation/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)"
		,"../../../features/agent-threads/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)"
		,"../../../features/conversation-workspace/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)"
	],
	addons:
	[
		"@storybook/addon-docs",
		"@storybook/addon-a11y"
	],
	framework:
	{
		name: "@storybook/angular",
		options: {}
	},
	webpackFinal(config)
	{
		return {
			...config,
			resolve:
			{
				...config.resolve,
				extensionAlias:
				{
					...config.resolve?.extensionAlias,
					".js": [".js", ".ts"]
				}
			}
		};
	}
};

export default config;
