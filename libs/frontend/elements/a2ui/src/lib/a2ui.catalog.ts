import { Button, Card, Image, List, Slider, Text, TextField, type Catalog } from "@a2ui/angular/v0_8";

import { A2uiChoiceComponent } from "./a2ui-choice.component";
import { A2uiDateTimeComponent } from "./a2ui-date-time.component";
import { A2uiComponentNames } from "./a2ui.types";

/** Load the upstream text renderer. */
function _loadText(): typeof Text { return Text; }

/** Load the upstream action-button renderer. */
function _loadButton(): typeof Button { return Button; }

/** Load the upstream text-field renderer. */
function _loadTextField(): typeof TextField { return TextField; }

/** Load our own accessible renderer, used for SingleChoice, MultipleChoice and Select. */
function _loadChoice(): typeof A2uiChoiceComponent { return A2uiChoiceComponent; }

/** Load the upstream numeric-slider renderer. */
function _loadSlider(): typeof Slider { return Slider; }

/** Load our own accessible adapter for DateTimeInput. */
function _loadDateTimeInput(): typeof A2uiDateTimeComponent { return A2uiDateTimeComponent; }

/** Load the upstream image renderer. */
function _loadImage(): typeof Image { return Image; }

/** Load the upstream card renderer. */
function _loadCard(): typeof Card { return Card; }

/** Load the upstream list renderer. */
function _loadList(): typeof List { return List; }

/**
 * Builds the catalogue of renderers the vendor is allowed to use.
 *
 * It deliberately does NOT spread the vendor's default catalogue: only the names in
 * {@link A2uiComponentNames} appear, so a component OpenCrane has not reviewed can never render.
 * Names outside the catalogue are rejected by the admission check before the vendor is called, and
 * the canvas shows a placeholder that repeats nothing from the payload.
 *
 * Most entries load the vendor's own renderer. Two do not: SingleChoice/MultipleChoice/Select all
 * load A2uiChoiceComponent, and DateTimeInput loads A2uiDateTimeComponent, because the vendor
 * renderers for those drop accessible labels.
 *
 * Called by: a2ui.providers.ts, which registers the result for A2uiCanvasComponent.
 *
 * @returns The catalogue to provide to the vendor renderer. Adding an entry also means adding the
 *   name to {@link A2uiComponentNames}, or admission will still reject it.
 * @see A2UI v0.8 specification — the upstream component list and each component's properties:
 *   https://a2ui.org/specification/v0.8-a2ui/
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
