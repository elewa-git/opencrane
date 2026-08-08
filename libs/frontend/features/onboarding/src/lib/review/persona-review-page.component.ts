import { ChangeDetectionStrategy, Component, inject, resource, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ConfirmationService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmDialogModule } from "primeng/confirmdialog";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { CollapsibleSectionComponent, JourneyShellComponent, JourneyShellLayouts, PersonaArchetypeScore, PersonaArchetypeTones, PersonaSummaryComponent } from "@opencrane/elements/ui";
import { PersonaColours, PersonaFirstChatService, PersonaOnboardingService, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaQuestion, PersonaResult, UserOnboardingRouteSnapshot, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { _OnboardingErrorMessage, _PersonaDescription, _PersonaScores, _PersonaTone, _PersonaValueLabel, _SelectedChoiceLabel } from "../onboarding-view.util";

/** Routed review and approval screen for one immutable server-derived persona draft. */
@Component({
	selector: "wo-persona-review-page",
	standalone: true,
	imports: [ButtonModule, CollapsibleSectionComponent, ConfirmDialogModule, JourneyShellComponent, MessageModule, PersonaSummaryComponent, ProgressSpinnerModule],
	providers: [ConfirmationService],
	templateUrl: "./persona-review-page.component.html",
	styleUrl: "../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaReviewPageComponent
{
	/** Server-backed persona lifecycle orchestration. */
	private readonly _persona = inject(PersonaOnboardingService);

	/** Server-owned onboarding route projection used after persona approval. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Router used only to move back to the authority-derived survey page. */
	private readonly _router = inject(Router);

	/** Component-scoped confirmation boundary for persona activation. */
	private readonly _confirmation = inject(ConfirmationService);

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;

	/** Persona lifecycle enum exposed for exhaustive review states. */
	public readonly states = PersonaOnboardingStates;

	/** Durable review snapshot loaded through Angular's async resource primitive. */
	public readonly onboarding = resource({ loader: this._load.bind(this) });

	/** Whether approval or a deliberate re-sort is in progress. */
	public readonly saving = signal<boolean>(false);

	/** Safe mutation failure that never implies activation. */
	public readonly actionError = signal<string | null>(null);

	/** Retry the authoritative review read after a blocking failure. */
	public retry(): void
	{
		this.onboarding.reload();
	}

	/** Ask for deliberate confirmation before activating the reviewed immutable revision. */
	public requestApproval(): void
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (!snapshot?.personaRevisionId || snapshot.result === null || snapshot.result.instructionPreview === null) return;
		const personaRevisionId: string = snapshot.personaRevisionId;
		const instructionPreview: string = snapshot.result.instructionPreview;
		this._confirmation.confirm({
			header: "Approve persona",
			message: `Activate ${snapshot.result.displayName} with the exact compiled instructions shown here for future admitted runs? Existing run snapshots will not change.`,
			icon: "pi pi-check-circle",
			acceptLabel: "Approve persona",
			rejectLabel: "Keep reviewing",
			accept: this._approve.bind(this, personaRevisionId, instructionPreview)
		});
	}

	/** Return the reviewed label for one server-recorded interview choice. */
	public selectedChoiceLabel(question: PersonaQuestion): string
	{
		return _SelectedChoiceLabel(question);
	}

	/** Approve only when the live review still matches the exact material confirmed. */
	private async _approve(personaRevisionId: string, instructionPreview: string): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (snapshot?.state !== PersonaOnboardingStates.Review || snapshot.personaRevisionId !== personaRevisionId || snapshot.result?.instructionPreview !== instructionPreview)
		{
			this.actionError.set("The persona review changed before approval. Review the current immutable instructions and confirm again.");
			return;
		}
		await this._run(async function _Approve(this: PersonaReviewPageComponent)
		{
			this.onboarding.set(await this._persona.approve(personaRevisionId));
			this._routeFromOnboarding(await this._firstChat.loadRouteState());
		}.bind(this));
	}

	/** Start a new governed interview instead of altering the current draft locally. */
	public async restart(): Promise<void>
	{
		await this._run(async function _Restart(this: PersonaReviewPageComponent)
		{
			const snapshot = await this._persona.restart();
			this.onboarding.set(snapshot);
			void this._router.navigateByUrl("/onboarding/survey");
		}.bind(this));
	}

	/** Map the primary colour to the shared semantic persona tone. */
	public tone(colour: PersonaColours): PersonaArchetypeTones
	{
		return _PersonaTone(colour);
	}

	/** Explain the selected primary collaboration style without diagnosing the owner. */
	public description(colour: PersonaColours): string
	{
		return _PersonaDescription(colour);
	}

	/** Render a server-owned colour or modifier as a human-readable label. */
	public label(value: string): string
	{
		return _PersonaValueLabel(value);
	}

	/** Derive display-only rounded bars from the lossless server score vector. */
	public scores(result: PersonaResult): readonly PersonaArchetypeScore[]
	{
		return _PersonaScores(result);
	}

	/** Load the exact durable review state, returning unfinished users to the survey. */
	private async _load(): Promise<PersonaOnboardingSnapshot>
	{
		const snapshot = await this._persona.load();
		if (snapshot.state === PersonaOnboardingStates.Interview || snapshot.state === PersonaOnboardingStates.Resolution)
		{
			void this._router.navigateByUrl("/onboarding/survey");
		}
		else if (snapshot.state === PersonaOnboardingStates.Ready)
		{
			this._routeFromOnboarding(await this._firstChat.loadRouteState());
		}
		return snapshot;
	}

	/** Route only from the public durable onboarding projection returned after approval. */
	private _routeFromOnboarding(onboarding: UserOnboardingRouteSnapshot): void
	{
		if (onboarding.state === UserOnboardingRouteStates.BootstrapChatPending || onboarding.state === UserOnboardingRouteStates.BootstrapChatInProgress)
		{
			void this._router.navigateByUrl("/onboarding/chat");
		}
		else if (onboarding.state === UserOnboardingRouteStates.Completed)
		{
			void this._router.navigateByUrl("/admin");
		}
	}

	/** Run one mutation while preserving the current draft and activation state on failure. */
	private async _run(operation: () => Promise<void>): Promise<void>
	{
		this.saving.set(true);
		this.actionError.set(null);
		try
		{
			await operation();
		}
		catch (error)
		{
			this.actionError.set(_OnboardingErrorMessage(error, "OpenCrane could not update this persona revision."));
		}
		finally
		{
			this.saving.set(false);
		}
	}
}
