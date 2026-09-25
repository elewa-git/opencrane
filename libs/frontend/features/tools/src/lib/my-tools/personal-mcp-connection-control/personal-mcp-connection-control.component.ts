import { ChangeDetectionStrategy, Component, ElementRef, Signal, ViewChild, afterRenderEffect, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";

import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds, type PersonalMcpConnectionControlView } from "./personal-mcp-connection-control.types";

/**
 * Presents one controlled personal MCP connection form without owning credentials or gateway work.
 *
 * The parent keeps the draft, retry identity, authority decisions, and authoritative connection
 * projection. This component only renders the supplied finite state and emits typed user intents.
 * Called by: the installed-tool row composed by the My Tools page.
 */
@Component({ selector: "wo-personal-mcp-connection-control", standalone: true, imports: [ButtonModule, InputTextModule], templateUrl: "./personal-mcp-connection-control.component.html", styleUrl: "./personal-mcp-connection-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class PersonalMcpConnectionControlComponent
{
	/** The rendered password field, when the current state needs one. */
	@ViewChild("credentialInput") private _credentialInput?: ElementRef<HTMLInputElement>;
	/** The persistent replacement action that receives focus after cancellation. */
	@ViewChild("replaceAction") private _replaceAction?: ElementRef<HTMLButtonElement>;
	/** Previous render coordinates used only to restore keyboard focus after a state change. */
	private _rendered: { state: PersonalMcpConnectionControlStates; error: string | null } | null = null;
	/** Restores focus after the parent adopts replacement, cancellation, or failure state. */
	private readonly _focusEffect = afterRenderEffect(this._RestoreFocus.bind(this));

	/** Complete browser-safe view state supplied by the parent presenter. */
	public readonly view = input.required<PersonalMcpConnectionControlView>();
	/** Whether the parent has admitted a command for this server. */
	public readonly busy = input(false);
	/** Fixed safe failure text for the current command. */
	public readonly error = input<string | null>(null);
	/** Reports an exact local edit without retaining a second credential copy. */
	public readonly draftChanged = output<string>();
	/** Requests Connect, Retry, or Replace as selected by the supplied view state. */
	public readonly submitRequested = output<void>();
	/** Requests entry into the parent-owned replacement state. */
	public readonly replaceRequested = output<void>();
	/** Requests revocation without treating it as installation removal. */
	public readonly revokeRequested = output<void>();
	/** Cancels an unsaved replacement draft and returns to the active projection. */
	public readonly cancelDraftRequested = output<void>();

	/** State enum exposed to the template without magic strings. */
	public readonly states = PersonalMcpConnectionControlStates;
	/** Whether this state renders the controlled bearer field. */
	public readonly showsCredentialInput: Signal<boolean> = computed(this._showsCredentialInput.bind(this));
	/** Whether the current submit intent satisfies its local input bound. */
	public readonly canSubmit: Signal<boolean> = computed(this._canSubmit.bind(this));
	/** State-specific action copy for the shared form submission path. */
	public readonly submitLabel: Signal<string> = computed(this._submitLabel.bind(this));

	/** Emit the exact password edit, including intentional surrounding whitespace. */
	public editDraft(event: Event): void
	{
		this.draftChanged.emit((event.target as HTMLInputElement).value);
	}

	/** Use the form's single submit path for both Enter and button activation. */
	public submit(event: SubmitEvent): void
	{
		event.preventDefault();
		if (this.canSubmit())
			this.submitRequested.emit();
	}

	/** Bearer input is shown only while starting, replacing, or retrying a bearer command. */
	private _showsCredentialInput(): boolean
	{
		const state = this.view().state;
		return this.view().credentialInput === PersonalMcpCredentialInputKinds.Bearer
			&& (state === PersonalMcpConnectionControlStates.Connect || state === PersonalMcpConnectionControlStates.Replace || state === PersonalMcpConnectionControlStates.Ambiguous);
	}

	/** Ambiguous retry uses its retained command; other bearer submissions require a bounded draft. */
	private _canSubmit(): boolean
	{
		if (this.busy())
			return false;
		if (this.view().state === PersonalMcpConnectionControlStates.Ambiguous)
			return true;
		const state = this.view().state;
		if (state !== PersonalMcpConnectionControlStates.Connect && state !== PersonalMcpConnectionControlStates.Replace)
			return false;
		if (this.view().credentialInput === PersonalMcpCredentialInputKinds.None)
			return true;
		return this.view().draft.length >= 1 && this.view().draft.length <= 8192;
	}

	/** Keep labels explicit so the parent does not infer which command the component emits. */
	private _submitLabel(): string
	{
		switch (this.view().state)
		{
			case PersonalMcpConnectionControlStates.Ambiguous: return "Retry";
			case PersonalMcpConnectionControlStates.Replace: return "Replace";
			default: return "Connect";
		}
	}

	/** Move focus only after a meaningful parent-owned state or failure transition. */
	private _RestoreFocus(): void
	{
		const next = { state: this.view().state, error: this.error() };
		const previous = this._rendered;
		this._rendered = next;
		if (previous === null)
			return;
		if (next.state === PersonalMcpConnectionControlStates.Replace && previous.state !== next.state)
		{
			this._credentialInput?.nativeElement.focus();
			return;
		}
		if (next.error !== null && next.error !== previous.error && this._credentialInput !== undefined)
		{
			this._credentialInput.nativeElement.focus();
			return;
		}
		if (previous.state === PersonalMcpConnectionControlStates.Replace && next.state === PersonalMcpConnectionControlStates.Active)
			this._replaceAction?.nativeElement.focus();
	}
}
