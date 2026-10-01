import { Card, Column, Divider, Row, type Catalog } from "@a2ui/angular/v0_8";

import { ConversationA2uiTextComponent } from "./conversation-a2ui-text.component";

/**
 * Restricts dynamic rendering to the static components checked by the workspace projection.
 * No default catalogue is merged: controls, media and third-party loaders cannot be selected.
 * Called by: ConversationA2uiDisplayComponent's local Catalog provider.
 * @returns A new registry without inherited keys or action-capable components.
 */
export function _ConversationA2uiDisplayCatalog(): Catalog
{
	return Object.assign(Object.create(null), { Text: _text, Row: _row, Column: _column, Card: _card, Divider: _divider });
}

/** Selects the literal-text presenter, which never interprets HTML or markdown. */
function _text(): typeof ConversationA2uiTextComponent { return ConversationA2uiTextComponent; }
/** Selects the existing static row layout. */
function _row(): typeof Row { return Row; }
/** Selects the existing static column layout. */
function _column(): typeof Column { return Column; }
/** Selects the existing card container. */
function _card(): typeof Card { return Card; }
/** Selects the horizontal divider admitted by the workspace projection. */
function _divider(): typeof Divider { return Divider; }
