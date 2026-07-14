import { definePreset } from "@primeng/themes";
import Aura from "@primeng/themes/aura";

/** Canonical teal action color from the UI handoff. */
const ACTION = "#0db5cc";

/** Darker action color used for hover and pressed states. */
const ACTION_HOVER = "#0797ad";

/** PrimeNG preset aligned with the OpenCrane handoff semantic tokens. */
export const OpenCranePreset = definePreset(Aura,
{
	semantic:
	{
		primary:
		{
			50: "#e8fbfe",
			100: "#c6f5fa",
			200: "#93eaf3",
			300: "#55d9e8",
			400: "#24c4d8",
			500: ACTION,
			600: ACTION_HOVER,
			700: "#08798d",
			800: "#0d6271",
			900: "#10525e",
			950: "#063640"
		}
	},
	components:
	{
		toggleswitch:
		{
			colorScheme:
			{
				light:
				{
					root:
					{
						checkedBackground: ACTION,
						checkedHoverBackground: ACTION_HOVER,
						checkedBorderColor: ACTION,
						checkedHoverBorderColor: ACTION_HOVER
					}
				}
			}
		}
	}
});
