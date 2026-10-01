import { ChangeDetectionStrategy, Component, Input, computed, signal } from "@angular/core";
import { DynamicComponent, type Types } from "@a2ui/angular/v0_8";

/**
 * Renders resolved literal text with Angular's normal text escaping. All heading hints render as
 * h2 below the route-owned h1; hints retain their token-based typography but cannot skip levels.
 * The inherited class supplies the renderer's non-visual input contract; no action or data method
 * is used. A path that escaped the projection displays nothing instead of reading another model.
 * Called by: the Text entry in _ConversationA2uiDisplayCatalog.
 */
@Component({ selector: "wo-conversation-a2ui-text", standalone: true, templateUrl: "./conversation-a2ui-text.component.html", styleUrl: "./conversation-a2ui-text.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationA2uiTextComponent extends DynamicComponent<Types.TextNode>
{
	/** Holds text received through the renderer's runtime-visible input setter. */
	private readonly _text = signal<Types.StringValue | null>(null);
	/** Selects heading typography, body or caption from the standard hint, never arbitrary styles. */
	protected readonly hint = signal<Types.ResolvedText["usageHint"]>("body");
	/** Literal text is the sole content path into this renderer. */
	protected readonly literal = computed(this._Literal.bind(this));
	/** Keeps dynamic input metadata available in both compiled and source-mode Angular rendering. */
	@Input() public set text(value: Types.StringValue | null) { this._text.set(value); }
	/** Updates the documented text hint when the dynamic renderer reuses this component. */
	@Input() public set usageHint(value: Types.ResolvedText["usageHint"]) { this.hint.set(value); }

	/** Refuses to resolve paths or interpret markup at the visual boundary. */
	private _Literal(): string
	{
		const text = this._text();
		if (text === null || !("literalString" in text))
			return "";
		return text.literalString ?? "";
	}
}
