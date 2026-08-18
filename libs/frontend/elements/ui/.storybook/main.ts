import type { StorybookConfig } from "@storybook/angular";

/** Storybook catalogue configuration for shared OpenCrane UI elements. */
const config: StorybookConfig =
{
	// One Storybook for the whole frontend, hosted by this package: the globs reach out into sibling
	// element packages and into feature packages so a reviewer sees every component in one catalogue.
	// Adding a package here also means adding it to `.storybook/tsconfig.json`, or its stories compile
	// against no project references.
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
		,"../../../features/settings/src/**/__tests__/*.stories.@(js|jsx|mjs|ts|tsx)"
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
					// Storybook builds these packages from source, but the repo writes relative imports
					// the NodeNext way, ending in `.js` while the file on disk is `.ts`. Without this
					// alias webpack looks for a `.js` file that was never emitted and every story fails
					// to resolve its component.
					".js": [".js", ".ts"]
				}
			}
		};
	}
};

export default config;
