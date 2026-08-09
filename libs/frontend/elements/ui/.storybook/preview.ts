import { provideZonelessChangeDetection } from "@angular/core";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { applicationConfig, type Preview } from "@storybook/angular";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";

/** Production-equivalent providers and deterministic defaults for component stories. */
const preview: Preview =
{
	decorators:
	[
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
