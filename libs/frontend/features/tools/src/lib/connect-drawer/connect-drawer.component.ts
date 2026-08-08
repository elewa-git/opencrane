import { ChangeDetectionStrategy, Component, Signal, computed, input, linkedSignal, output } from "@angular/core";
import { DrawerModule } from "primeng/drawer";

import { McpConnectionStatus, McpCredentialField, McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";
import { AvatarCircleComponent, AvatarSizes, AvatarTones } from "@opencrane/elements/ui";
import { MCP_TYPE_CHIPS } from "../mcp-chip.constants";

/**
 * Connect / Set-credential drawer — the single secure entry point for binding a
 * credential to an MCP server.
 *
 * Presentational: it renders the variant chosen by the server's
 * {@link McpServerType} (single-user token form, multi-user shared-key notice,
 * or remote OAuth) and **emits intents** ({@link saveRequested}, etc.) for the
 * parent to fulfil against the gateway — it holds no transport. Sensitive
 * fields are write-only: a stored value is never read back, so a connected
 * server shows a masked "set · Replace" state rather than the value.
 */
@Component({
	selector: "wo-connect-drawer",
	standalone: true,
	imports: [DrawerModule, AvatarCircleComponent],
	templateUrl: "./connect-drawer.component.html",
	styleUrl: "./connect-drawer.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConnectDrawerComponent
{
	/** Finite avatar tones exposed for the connected-account identity. */
	public readonly avatarTones = AvatarTones;

	/** Finite avatar sizes exposed for the connected-account identity. */
	public readonly avatarSizes = AvatarSizes;

	/** Server to connect, or `null` when the drawer is closed. */
	public readonly server = input<McpServer | null>(null);

	/** The user's installed record for {@link server}, when already installed. */
	public readonly installed = input<McpInstalledServer | null>(null);

	/** Emitted when the drawer is dismissed. */
	public readonly closed = output<void>();

	/** Emitted with the field values when the user saves a credential. */
	public readonly saveRequested = output<Record<string, string>>();

	/** Emitted when the user removes a stored credential. */
	public readonly removeRequested = output<void>();

	/** Emitted when the user starts the OAuth connect. */
	public readonly connectRequested = output<void>();

	/** Emitted when the user disconnects an OAuth/token connection. */
	public readonly disconnectRequested = output<void>();

	/** Server-type enum for the template. */
	public readonly serverType = McpServerType;

	/** Feature-owned labels and semantic tones for server types. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** Whether the drawer is open (mirrors a non-null server). */
	public readonly visible: Signal<boolean> = computed((): boolean => this.server() !== null);

	/** Drawer title, e.g. "Connect stripe". */
	public readonly title: Signal<string> = computed((): string => `Connect ${this.server()?.name ?? ""}`);

	/** Credential fields from the server's config schema. */
	public readonly fields: Signal<McpCredentialField[]> = computed((): McpCredentialField[] => this.server()?.credentialSchema ?? []);

	/** Whether a single-user credential is already stored (server is connected). */
	public readonly credentialSet: Signal<boolean> = computed((): boolean => this.installed()?.connectionStatus === McpConnectionStatus.Connected);

	/** Whether a remote/OAuth server is already connected. */
	public readonly oauthConnected: Signal<boolean> = computed((): boolean => this.installed()?.connectionStatus === McpConnectionStatus.OauthConnected);

	/** Connected OAuth account label, when known. */
	public readonly connectedAccount: Signal<string | undefined> = computed((): string | undefined => this.installed()?.connectedAccount);

	/** Whether the user chose to replace an already-set credential. Resets per server. */
	public readonly replaceMode = linkedSignal<boolean>((): boolean => { this.server(); return false; });

	/** Working copy of the credential field values, seeded empty per server. */
	public readonly formValues = linkedSignal<Record<string, string>>((): Record<string, string> =>
	{
		const seed: Record<string, string> = {};
		for (const field of this.server()?.credentialSchema ?? [])
		{
			seed[field.key] = "";
		}
		return seed;
	});

	/** Show the editable token form (unset, or replacing an existing credential). */
	public readonly showTokenForm: Signal<boolean> = computed((): boolean => !this.credentialSet() || this.replaceMode());

	/** Whether every required field has a value (gates the save button). */
	public readonly canSubmit: Signal<boolean> = computed((): boolean =>
	{
		const values = this.formValues();
		return this.fields().filter(function isRequired(field: McpCredentialField): boolean { return field.required; })
			.every(function hasValue(field: McpCredentialField): boolean { return (values[field.key] ?? "").trim() !== ""; });
	});

	/** Label of the primary sensitive field, for the "set" state. */
	public readonly sensitiveLabel: Signal<string> = computed((): string =>
	{
		const field = this.fields().find(function isSensitive(candidate: McpCredentialField): boolean { return candidate.sensitive; });
		return field?.label ?? "Credential";
	});

	/** Two-letter initials derived from the connected OAuth account. */
	public readonly accountInitials: Signal<string> = computed((): string =>
	{
		const account = this.connectedAccount() ?? "";
		return account.slice(0, 2).toUpperCase();
	});

	/** Update one field value from its input event. */
	public onFieldInput(key: string, event: Event): void
	{
		const value = (event.target as HTMLInputElement).value;
		this.formValues.update(function set(current: Record<string, string>): Record<string, string> { return { ...current, [key]: value }; });
	}

	/** Submit the entered credential values. */
	public submit(): void
	{
		this.saveRequested.emit(this.formValues());
	}

	/** Switch the set-state into replace (editable) mode. */
	public replace(): void
	{
		this.replaceMode.set(true);
	}

	/** Request removal of the stored credential. */
	public remove(): void
	{
		this.removeRequested.emit();
	}

	/** Request the OAuth connect. */
	public connect(): void
	{
		this.connectRequested.emit();
	}

	/** Request an OAuth/token disconnect. */
	public disconnect(): void
	{
		this.disconnectRequested.emit();
	}

	/** Close the drawer. */
	public close(): void
	{
		this.closed.emit();
	}

	/** Bridge the PrimeNG drawer's visibility change to the {@link closed} output. */
	public onVisibleChange(open: boolean): void
	{
		if (!open)
		{
			this.closed.emit();
		}
	}
}
