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
			},
			colorScheme:
			{
				light:
				{
					root:
					{
						danger:
						{
							background: "var(--oc-danger)",
							hoverBackground: "var(--oc-danger)",
							activeBackground: "var(--oc-danger)",
							borderColor: "var(--oc-danger)",
							hoverBorderColor: "var(--oc-danger)",
							activeBorderColor: "var(--oc-danger)"
						}
					},
					text:
					{
						primary:
						{
							color: "{primary.700}"
						}
					}
				}
			}
		},
		message:
		{
			colorScheme:
			{
				light:
				{
					info: { background: "var(--oc-info-soft)", borderColor: "var(--oc-info)", color: "var(--oc-info)" },
					success: { background: "var(--oc-success-soft)", borderColor: "var(--oc-success)", color: "var(--oc-success)" },
					warn: { background: "var(--oc-warning-soft)", borderColor: "var(--oc-warning)", color: "var(--oc-warning)" },
					error: { background: "var(--oc-danger-soft)", borderColor: "var(--oc-danger)", color: "var(--oc-danger)" },
					secondary: { background: "var(--oc-neutral-soft)", borderColor: "var(--oc-border-strong)", color: "var(--oc-ink-default)" }
				}
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
