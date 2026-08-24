import { provideZonelessChangeDetection } from "@angular/core";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { applicationConfig, componentWrapperDecorator, type Decorator, type Preview } from "@storybook/angular";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";

/** Opt-in tag for stories that need the application shell's viewport-height parent. */
const _FULL_VIEWPORT_TAG = "visual-test-full-viewport";

/** Wraps a routed fullscreen story in the production-equivalent viewport-height parent. */
const _FULL_VIEWPORT_WRAPPER = componentWrapperDecorator(function _ViewportWrapper(story: string): string
{
	return `<div style="block-size:100dvh;overflow:hidden">${story}</div>`;
});

/** Applies the viewport parent only to the explicitly tagged full-screen visual contracts. */
const _FULL_VIEWPORT_DECORATOR: Decorator = function _FullViewportDecorator(story, context)
{
	if (!context.tags?.includes(_FULL_VIEWPORT_TAG)) return story();
	return _FULL_VIEWPORT_WRAPPER(story, context);
};

/** Production-equivalent providers and deterministic defaults for component stories. */
const preview: Preview =
{
	decorators:
	[
		_FULL_VIEWPORT_DECORATOR,
		applicationConfig(
		{
			providers:
			[
				provideZonelessChangeDetection(),
				provideAnimationsAsync(),
				providePrimeNG(
				{
					theme:
					{
						preset: OpenCranePreset
					}
				})
			]
		})
	],
	parameters:
	{
		a11y:
		{
			test: "error"
		},
		controls:
		{
			matchers:
			{
				color: /(background|color)$/iu,
				date: /Date$/iu
			}
		},
		layout: "fullscreen"
	}
};

export default preview;
