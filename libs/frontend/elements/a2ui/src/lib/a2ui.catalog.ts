import { Button, Card, DateTimeInput, Image, List, MultipleChoice, Slider, Text, TextField, type Catalog } from "@a2ui/angular/v0_8";

import { A2uiComponentNames } from "./a2ui.types.js";

/** Load the upstream text renderer. */
function _loadText(): typeof Text { return Text; }

/** Load the upstream action-button renderer. */
function _loadButton(): typeof Button { return Button; }

/** Load the upstream text-field renderer. */
function _loadTextField(): typeof TextField { return TextField; }

/** Load the upstream choice renderer shared by the three admitted choice contracts. */
function _loadChoice(): typeof MultipleChoice { return MultipleChoice; }

/** Load the upstream numeric-slider renderer. */
function _loadSlider(): typeof Slider { return Slider; }

/** Load the upstream date-time renderer. */
function _loadDateTimeInput(): typeof DateTimeInput { return DateTimeInput; }

/** Load the upstream image renderer. */
function _loadImage(): typeof Image { return Image; }

/** Load the upstream card renderer. */
function _loadCard(): typeof Card { return Card; }

/** Load the upstream list renderer. */
function _loadList(): typeof List { return List; }

/**
 * Build the exact OpenCrane A2UI catalogue.
 *
 * This intentionally does not spread the upstream default catalogue. Unknown names are rejected
 * before processing and render one package-owned unsupported placeholder without payload details.
 */
export function _OpenCraneA2uiCatalog(): Catalog
{
	return {
		[A2uiComponentNames.Text]: _loadText,
		[A2uiComponentNames.Button]: _loadButton,
		[A2uiComponentNames.TextField]: _loadTextField,
		[A2uiComponentNames.SingleChoice]: _loadChoice,
		[A2uiComponentNames.MultipleChoice]: _loadChoice,
		[A2uiComponentNames.Select]: _loadChoice,
		[A2uiComponentNames.Slider]: _loadSlider,
		[A2uiComponentNames.DateTimeInput]: _loadDateTimeInput,
		[A2uiComponentNames.Image]: _loadImage,
		[A2uiComponentNames.Card]: _loadCard,
		[A2uiComponentNames.List]: _loadList
	};
}
