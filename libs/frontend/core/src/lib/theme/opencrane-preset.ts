import { definePreset } from "@primeng/themes";
import Aura from "@primeng/themes/aura";

/**
 * OpenCrane's PrimeNG preset.
 *
 * Aura retains the accessible interaction anatomy while this preset maps
 * controls onto the same cyan, paper, ink, and focus language as the product
 * shell. Component styles consume the matching CSS tokens in `opencrane-theme.scss`.
 */
export const OpenCranePreset = definePreset(Aura,
{
	semantic:
	{
		primary:
		{
			50: "#e9fbfe",
			100: "#cff6fb",
			200: "#9eeaf4",
			300: "#65d9e9",
			400: "#2bc5d8",
			500: "#0db5cc",
			600: "#0a94a7",
			700: "#0b7787",
			800: "#105f6c",
			900: "#124f59",
			950: "#052f37"
		},
		colorScheme:
		{
			light:
			{
				primary:
				{
					color: "{primary.500}",
					contrastColor: "#16191a",
					hoverColor: "{primary.600}",
					activeColor: "{primary.700}"
				},
				highlight:
				{
					background: "{primary.50}",
					focusBackground: "{primary.100}",
					color: "{primary.800}",
					focusColor: "{primary.900}"
				}
			}
		}
	},
	components:
	{
		button:
		{
			root:
			{
				borderRadius: "7px"
			}
		},
		progressspinner:
		{
			colorScheme:
			{
				light:
				{
					root:
					{
						colorOne: "{primary.400}",
						colorTwo: "{primary.500}",
						colorThree: "{primary.600}",
						colorFour: "{primary.700}"
					}
				}
			}
		},
		radiobutton:
		{
			root:
			{
				checkedBackground: "{primary.500}",
				checkedHoverBackground: "{primary.600}",
				checkedBorderColor: "{primary.500}",
				checkedHoverBorderColor: "{primary.600}"
			}
		},
		toggleswitch:
		{
			colorScheme:
			{
				light:
				{
					root:
					{
						checkedBackground: "{primary.500}",
						checkedHoverBackground: "{primary.600}",
						checkedBorderColor: "{primary.500}",
						checkedHoverBorderColor: "{primary.600}"
					},
					handle:
					{
						checkedColor: "{primary.500}",
						checkedHoverColor: "{primary.600}"
					}
				}
			}
		}
	}
});
