import type { StorybookConfig } from "@storybook/angular";

/** Storybook catalogue configuration for shared OpenCrane UI elements. */
const config: StorybookConfig =
{
	stories:
	[
		"../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
		"../../../features/onboarding/src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
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
