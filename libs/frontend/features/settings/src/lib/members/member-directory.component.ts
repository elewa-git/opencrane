import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InputTextModule } from "primeng/inputtext";
import { TableModule } from "primeng/table";
import { TabsModule } from "primeng/tabs";

import { MemberDirectoryRowComponent } from "./member-directory-row.component";
import { MemberDirectoryTabs, type MemberDirectoryRowView } from "./member-directory.types";

/** Searchable active/pending directory using the same row contract at wide and narrow widths. */
@Component({ selector: "wo-member-directory", standalone: true, imports: [FormsModule, InputTextModule, TableModule, TabsModule, MemberDirectoryRowComponent], templateUrl: "./member-directory.component.html", styleUrl: "./member-directory.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MemberDirectoryComponent
{
	/** Server-computed active count. */
	public readonly activeCount = input.required<number>();
	/** Server-computed pending count plus authoritative mutation overlays. */
	public readonly pendingCount = input.required<number>();
	/** Search-filtered accepted rows. */
	public readonly activeRows = input.required<readonly MemberDirectoryRowView[]>();
	/** Search-filtered invitation rows. */
	public readonly pendingRows = input.required<readonly MemberDirectoryRowView[]>();
	/** Mutable table projection required by PrimeNG without weakening the readonly view contract. */
	protected readonly activeTableRows = computed((): MemberDirectoryRowView[] => [...this.activeRows()]);
	/** Mutable table projection required by PrimeNG without weakening the readonly view contract. */
	protected readonly pendingTableRows = computed((): MemberDirectoryRowView[] => [...this.pendingRows()]);
	/** Controlled search query. */
	public readonly searchQuery = input.required<string>();
	/** Emits exact search input for the route's presentation computed. */
	public readonly searchChanged = output<string>();
	/** Emits an opaque invitation coordinate for resend admission. */
	public readonly resendRequested = output<string>();
	/** Stable tab values exposed to the template. */
	protected readonly tabs = MemberDirectoryTabs;

	/** Translate the native input event into controlled search text. */
	protected updateSearch(event: Event): void { this.searchChanged.emit((event.target as HTMLInputElement).value); }
}
