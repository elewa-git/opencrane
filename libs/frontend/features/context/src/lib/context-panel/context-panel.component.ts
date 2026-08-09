import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";

import { ActiveSkill, CanvasDocument, CanvasDocumentSaveStates, LedgerEntry, SCOPE_COLORS, ScopeCitation, ScopeContextEntry, ScopeLevel } from "@opencrane/core";
import { CollapsibleSectionComponent, LedgerCardComponent, LedgerCardKinds } from "@opencrane/elements/ui";
import { CanvasDocComponent } from "../components/canvas-doc/canvas-doc.component";

/** Right panel: awareness contract, retrieved context, skills, ledger, canvas. */
@Component({
	selector: "wo-context-panel",
	standalone: true,
	imports: [CollapsibleSectionComponent, LedgerCardComponent, CanvasDocComponent],
	templateUrl: "./context-panel.component.html",
	styleUrl: "./context-panel.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContextPanelComponent
{
	/** UI-owned ledger kind for each domain entry discriminator. */
	private static readonly _LEDGER_KINDS: Record<string, LedgerCardKinds> =
	{
		[LedgerCardKinds.Observation]: LedgerCardKinds.Observation,
		[LedgerCardKinds.Policy]: LedgerCardKinds.Policy,
		[LedgerCardKinds.Action]: LedgerCardKinds.Action
	};

	/** Emits when the panel close button is clicked. */
	public readonly closed = output<void>();

	/** Canvas document selected by the owning workspace, or null before selection. */
	public readonly canvasDocument = input<CanvasDocument | null>(null);

	/** Canvas save lifecycle supplied by the owning workspace. */
	public readonly canvasSaveState = input<CanvasDocumentSaveStates>(CanvasDocumentSaveStates.Idle);

	/** Emits a canvas save intent for the owning workspace to admit. */
	public readonly canvasSaveRequested = output<void>();

	/** Emits a canvas export intent for the owning workspace to handle. */
	public readonly canvasExportRequested = output<void>();

	/** Active tab ("context" | "ledger" | "canvas"). */
	public readonly tab = signal<string>("context");

	/** Expanded scope in the retrieved-context rail. */
	public readonly expandedScope = signal<ScopeLevel | null>(null);

	/** Scope datasets — populated from the live gateway once available. */
	public readonly scopeEntries: ScopeContextEntry[] = [];

	/** Retrieved citations across scopes — populated from the live gateway once available. */
	public readonly citations: ScopeCitation[] = [];

	/** Active skills — populated from the live gateway once available. */
	public readonly skills: ActiveSkill[] = [];

	/** Ledger trace entries — populated from the live gateway once available. */
	public readonly ledger: LedgerEntry[] = [];

	/** Scope levels for the contract chip strip. */
	public readonly scopeLevels: ScopeLevel[] = [ScopeLevel.Org, ScopeLevel.Dept, ScopeLevel.Project, ScopeLevel.Personal];

	/** Scope → colour lookup for templates. */
	public readonly scopeColors = SCOPE_COLORS;

	/** Resolve an admitted domain entry to a finite shared-card treatment. */
	public ledgerKind(kind: string): LedgerCardKinds
	{
		return ContextPanelComponent._LEDGER_KINDS[kind] ?? LedgerCardKinds.Observation;
	}

	/** Citations retrieved at a given scope (empty until the live gateway lands). */
	public citationsFor(level: ScopeLevel): ScopeCitation[]
	{
		return this.citations.filter(function atScope(citation: ScopeCitation): boolean
		{
			return citation.scope === level;
		});
	}

	/** Toggles a scope row expansion. */
	public toggleScope(level: ScopeLevel): void
	{
		this.expandedScope.set(this.expandedScope() === level ? null : level);
	}
}
