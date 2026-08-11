import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ElicitationBodyKinds, ElicitationRequestStates, type ConversationElicitation, type ElicitationApprovalBody, type ElicitationFreeTextBody, type ElicitationMultipleChoiceBody, type ElicitationResponseValue, type ElicitationSingleChoiceBody } from "@opencrane/contracts";
import { ElicitationApprovalComponent, ElicitationFreeTextComponent, ElicitationMultipleChoiceComponent, ElicitationSingleChoiceComponent } from "@opencrane/elements/elicitation";

/** Recoverable conversation card for one server-owned participant request. */
@Component({
	selector: "wo-conversation-elicitation-card",
	standalone: true,
	imports: [ButtonModule, ElicitationApprovalComponent, ElicitationFreeTextComponent, ElicitationMultipleChoiceComponent, ElicitationSingleChoiceComponent, MessageModule],
	templateUrl: "./conversation-elicitation-card.component.html",
	styleUrl: "./conversation-elicitation-card.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConversationElicitationCardComponent
{
	/** Exact authoritative request projection. */
	public readonly elicitation = input.required<ConversationElicitation>();
	/** Selected local draft retained by the parent store. */
	public readonly draft = input<ElicitationResponseValue | null>(null);
	/** Whether an exact response command is active. */
	public readonly busy = input(false);
	/** Bounded browser-safe failure message. */
	public readonly error = input<string | null>(null);
	/** Fixed server-owned sign-in recovery path, when required. */
	public readonly stepUpPath = input<string | null>(null);
	/** Emits local selection without submitting it. */
	public readonly draftSelected = output<ElicitationResponseValue>();
	/** Emits the separate submit intent. */
	public readonly submitRequested = output<void>();
	/** Emits sign-in recovery intent without navigating inside the component. */
	public readonly stepUpRequested = output<string>();
	/** Stable contract enums used by the template. */
	protected readonly states = ElicitationRequestStates;
	/** Narrow approval body when selected by the server discriminant. */
	protected readonly approvalBody = computed(this._ApprovalBody.bind(this));
	/** Narrow single-choice body when selected by the server discriminant. */
	protected readonly singleChoiceBody = computed(this._SingleChoiceBody.bind(this));
	/** Narrow multiple-choice body when selected by the server discriminant. */
	protected readonly multipleChoiceBody = computed(this._MultipleChoiceBody.bind(this));
	/** Narrow free-text body when selected by the server discriminant. */
	protected readonly freeTextBody = computed(this._FreeTextBody.bind(this));

	/** Whether the exact draft satisfies local shape and body bounds. */
	protected canSubmit(): boolean
	{
		const draft = this.draft();
		const body = this.elicitation().body;
		if (this.busy() || this.elicitation().state !== ElicitationRequestStates.Requested || draft === null || draft.kind !== body.kind) return false;
		if (draft.kind === ElicitationBodyKinds.MultipleChoice && body.kind === ElicitationBodyKinds.MultipleChoice) return draft.selections.length >= body.minimumSelections && draft.selections.length <= body.maximumSelections;
		if (draft.kind === ElicitationBodyKinds.FreeText && body.kind === ElicitationBodyKinds.FreeText) return draft.text.length <= body.maximumLength && (body.allowEmpty || draft.text.trim().length > 0);
		return true;
	}

	/** Emit the exact fixed recovery path. */
	protected recover(): void
	{
		const path = this.stepUpPath();
		if (path !== null) this.stepUpRequested.emit(path);
	}

	/** Controlled approval selection. */
	protected approvalValue(): boolean | null { const draft = this.draft(); return draft?.kind === ElicitationBodyKinds.Approval ? draft.approved : null; }
	/** Controlled single selection. */
	protected singleChoiceValue(): string | null { const draft = this.draft(); return draft?.kind === ElicitationBodyKinds.SingleChoice ? draft.selection : null; }
	/** Controlled multiple selection. */
	protected multipleChoiceValue(): readonly string[] { const draft = this.draft(); return draft?.kind === ElicitationBodyKinds.MultipleChoice ? draft.selections : []; }
	/** Controlled free-text draft. */
	protected freeTextValue(): string { const draft = this.draft(); return draft?.kind === ElicitationBodyKinds.FreeText ? draft.text : ""; }
	/** Narrow approval body. */
	private _ApprovalBody(): ElicitationApprovalBody | null { const body = this.elicitation().body; return body.kind === ElicitationBodyKinds.Approval ? body : null; }
	/** Narrow single-choice body. */
	private _SingleChoiceBody(): ElicitationSingleChoiceBody | null { const body = this.elicitation().body; return body.kind === ElicitationBodyKinds.SingleChoice ? body : null; }
	/** Narrow multiple-choice body. */
	private _MultipleChoiceBody(): ElicitationMultipleChoiceBody | null { const body = this.elicitation().body; return body.kind === ElicitationBodyKinds.MultipleChoice ? body : null; }
	/** Narrow free-text body. */
	private _FreeTextBody(): ElicitationFreeTextBody | null { const body = this.elicitation().body; return body.kind === ElicitationBodyKinds.FreeText ? body : null; }
}
