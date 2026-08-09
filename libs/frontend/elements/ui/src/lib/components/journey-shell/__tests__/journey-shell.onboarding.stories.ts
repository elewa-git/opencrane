import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { ChoiceCardGroupComponent } from "../../choice-card-group/choice-card-group.component";
import { ChoiceCardLayouts, ChoiceCardOption } from "../../choice-card-group/choice-card-group.types";
import { CollapsibleSectionComponent } from "../../collapsible-section/collapsible-section.component";
import { JourneyProgressComponent } from "../../journey-progress/journey-progress.component";
import { PersonaSummaryComponent } from "../../persona-summary/persona-summary.component";
import { PersonaArchetypeScore, PersonaArchetypeTones } from "../../persona-summary/persona-summary.types";
import { JourneyShellComponent } from "../journey-shell.component";
import { JourneyShellLayouts } from "../journey-shell.types";

/** Stable onboarding answers used by the journey composition. */
const _ONBOARDING_OPTIONS: readonly ChoiceCardOption[] =
[
	{ id: "recommend", label: "Give me the recommendation", description: "Lead with the call, then show the evidence." },
	{ id: "context", label: "Build the context", description: "Explain what matters before choosing a direction." },
	{ id: "options", label: "Keep options open", description: "Compare several paths before committing." },
	{ id: "challenge", label: "Challenge my premise", description: "Test whether I am solving the right problem." }
];

/** Exact tied archetypes offered for explicit owner resolution. */
const _TIED_OPTIONS: readonly ChoiceCardOption[] =
[
	{ id: "commander", label: "Commander", description: "Direct, decisive, and explicit about the next move." },
	{ id: "analyst", label: "Analyst", description: "Evidence-led, methodical, and explicit about uncertainty." }
];

/** Complete rounded score vector shown in reviewed persona summaries. */
const _PERSONA_SCORES: readonly PersonaArchetypeScore[] =
[
	{ id: "analyst", label: "Analyst", percentage: 38, tone: PersonaArchetypeTones.Analyst },
	{ id: "anchor", label: "Anchor", percentage: 29, tone: PersonaArchetypeTones.Anchor },
	{ id: "commander", label: "Commander", percentage: 18, tone: PersonaArchetypeTones.Commander },
	{ id: "catalyst", label: "Catalyst", percentage: 15, tone: PersonaArchetypeTones.Catalyst }
];

/** Storybook metadata for persona survey and review states. */
const meta: Meta<JourneyShellComponent> =
{
	title: "Foundation/Journey shell",
	component: JourneyShellComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The shared visual frame for server-owned journeys. These onboarding compositions document the feedback users need while the feature retains control of routing, durable state, and every transition."
			}
		}
	},
	decorators: [moduleMetadata({ imports: [ButtonModule, ChoiceCardGroupComponent, CollapsibleSectionComponent, JourneyProgressComponent, MessageModule, PersonaSummaryComponent, ProgressSpinnerModule] })]
};

export default meta;

/** Local Storybook story type for onboarding journeys. */
type Story = StoryObj<JourneyShellComponent>;

/** Ten-question onboarding composition using the shared choice-card contract. */
export const OnboardingQuestion: Story =
{
	parameters: { docs: { description: { story: "Question six of a ten-question survey with an already saved answer. It shows the ordinary decision surface: local selection is clear, while the surrounding feature owns durable admission and navigation." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, choiceLayouts: ChoiceCardLayouts, options: _ONBOARDING_OPTIONS },
			template: `
				<wo-journey-shell title="How should your agent help when a decision is unclear?" description="Choose the answer that feels most natural. Your agent will explain what it inferred before anything becomes active." [layout]="layouts.Compact">
					<div journey-eyebrow style="margin-bottom:var(--oc-space-3);font:500 var(--oc-text-xs) var(--oc-font-mono);color:var(--oc-accent);text-transform:uppercase;letter-spacing:var(--oc-tracking-label)">Persona sorting</div>
					<wo-journey-progress journey-progress label="Persona sorting progress" statusLabel="Question 6 of 10 · 5 answers saved" [completed]="5" [total]="10" />
					<wo-choice-card-group controlId="story-persona-question" legend="Choose one answer" [options]="options" selectedId="recommend" [layout]="choiceLayouts.Grid" />
					<p-button journey-actions label="Back" severity="secondary" [text]="true" /><p-button journey-actions label="Continue" icon="pi pi-arrow-right" iconPos="right" />
				</wo-journey-shell>`
		};
	}
};

/** Blocking read while the server resolves the durable interview position. */
export const InterviewLoading: Story =
{
	parameters: { docs: { description: { story: "The blocking read while the server resolves the reviewed question set and saved position. It explicitly avoids presenting a guessed question or progress count before the authority responds." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="Loading your saved interview" description="OpenCrane is resolving the exact question set and last durable answer." [layout]="layouts.Compact" [busy]="true">
					<div style="display:flex;align-items:center;gap:var(--oc-space-3);color:var(--oc-ink-muted)" role="status">
						<p-progressspinner ariaLabel="Loading saved persona interview" data-visual-target="progress-spinner" [style]="{ width: '24px', height: '24px' }" strokeWidth="5" />
						<span>Checking your onboarding position…</span>
					</div>
				</wo-journey-shell>
			`
		};
	}
};

/** Durable resume state begins at the next unanswered question. */
export const ResumeInterview: Story =
{
	parameters: { docs: { description: { story: "A durable resume at the next unanswered question. It makes the retained answer count visible and keeps Continue unavailable until the current answer is selected." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, choiceLayouts: ChoiceCardLayouts, options: _ONBOARDING_OPTIONS },
			template: `
				<wo-journey-shell title="Continue your persona interview" description="Five answers are already saved against this reviewed question set." [layout]="layouts.Compact">
					<p-message journey-status severity="info" [closable]="false">Resumed at your next unanswered question.</p-message>
					<wo-journey-progress journey-progress label="Persona sorting progress" statusLabel="Question 6 of 10 · 5 answers saved" [completed]="5" [total]="10" />
					<wo-choice-card-group controlId="story-resumed-question" legend="When a decision is unclear, what should your agent do first?" [options]="options" [layout]="choiceLayouts.Grid" />
					<p-button journey-actions label="Continue" icon="pi pi-arrow-right" iconPos="right" [disabled]="true" />
				</wo-journey-shell>
			`
		};
	}
};

/** Failed answer persistence keeps the exact selected choice reviewable. */
export const AnswerSaveError: Story =
{
	parameters: { docs: { description: { story: "A failed save that leaves the exact selected answer visible and does not advance progress. It documents a recoverable retry affordance while preserving the server as the source of truth." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, choiceLayouts: ChoiceCardLayouts, options: _ONBOARDING_OPTIONS },
			template: `
				<wo-journey-shell title="We could not save this answer" description="OpenCrane has not advanced the interview. Retry the same selected answer." [layout]="layouts.Compact">
					<p-message journey-status severity="error" [closable]="false">The answer is not recorded yet. Your five earlier answers remain saved.</p-message>
					<wo-journey-progress journey-progress label="Persona sorting progress" statusLabel="Question 6 of 10 · 5 answers saved" [completed]="5" [total]="10" />
					<wo-choice-card-group controlId="story-save-error" legend="Choose one answer" [options]="options" selectedId="recommend" [layout]="choiceLayouts.Grid" />
					<p-button journey-actions label="Retry saving" icon="pi pi-refresh" />
				</wo-journey-shell>
			`
		};
	}
};

/** Tied score is unresolved until the owner chooses one exact candidate. */
export const TiedScoreResolution: Story =
{
	parameters: { docs: { description: { story: "An unresolved scoring tie that needs the owner's explicit choice before a persona draft exists. It prevents an apparently neutral visual tie-break from silently selecting an identity." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, choiceLayouts: ChoiceCardLayouts, options: _TIED_OPTIONS },
			template: `
				<wo-journey-shell title="Two working styles fit equally well" description="Commander and Analyst both scored 34%. Choose the one that should lead; OpenCrane will keep the other as a secondary influence." [layout]="layouts.Compact">
					<p-message journey-status severity="info" [closable]="false">No persona draft exists yet. Your explicit choice resolves this tie.</p-message>
					<wo-choice-card-group controlId="story-tied-archetype" legend="Choose the primary archetype" [options]="options" [layout]="choiceLayouts.Stack" />
					<p-button journey-actions label="Continue" icon="pi pi-arrow-right" iconPos="right" [disabled]="true" />
				</wo-journey-shell>`
		};
	}
};

/** Persona result composition with archetype scores, evidence, and approval action. */
export const PersonaResult: Story =
{
	parameters: { docs: { description: { story: "The review surface for a proposed persona, its score vector, and the evidence behind it. Approval is intentionally shown as an explicit action rather than an automatic consequence of displaying the result." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, personaTones: PersonaArchetypeTones, scores: _PERSONA_SCORES },
			template: `
				<wo-journey-shell title="Your starting persona" description="Review the result and the evidence behind it before this persona becomes active." [layout]="layouts.Wide">
					<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(16rem,.9fr);gap:var(--oc-space-6)">
						<wo-persona-summary componentId="story-persona-result" archetype="The Analyst" [tone]="personaTones.Analyst" description="Methodical, evidence-led, and comfortable naming uncertainty." secondaryInfluence="Anchor" modifier="Explorer" [scores]="scores" />
						<div style="display:grid;align-content:start;gap:var(--oc-space-3)"><wo-collapsible-section sectionId="story-result-evidence" title="Why this result"><ul style="margin:0;padding:0 var(--oc-space-6);color:var(--oc-ink-muted);line-height:1.7"><li>You asked for sources before confidence.</li><li>You prefer explicit trade-offs.</li><li>You keep alternatives visible.</li></ul></wo-collapsible-section><wo-collapsible-section sectionId="story-soul-preview" title="SOUL preview" [defaultOpen]="false"><p style="margin:0;padding:0 var(--oc-space-4);color:var(--oc-ink-muted)">I will separate observed evidence from inference.</p></wo-collapsible-section></div>
					</div>
					<p-button journey-actions label="Sort again" severity="secondary" [text]="true" /><p-button journey-actions label="Approve persona" icon="pi pi-check" />
				</wo-journey-shell>`
		};
	}
};

/** Draft generation preserves completed evidence while review content is prepared. */
export const PersonaDraftLoading: Story =
{
	parameters: { docs: { description: { story: "The busy state after evidence is complete but before a reviewed persona draft is ready. It reassures the owner that answers are frozen while avoiding a premature preview of inactive content." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts },
			template: `
				<wo-journey-shell title="Preparing your persona for review" description="Your ten answers are frozen. OpenCrane is compiling the exact reviewed persona draft." [layout]="layouts.Compact" [busy]="true">
					<wo-journey-progress journey-progress label="Persona sorting progress" statusLabel="Interview complete · 10 answers saved" [completed]="10" [total]="10" />
					<div style="display:flex;align-items:center;gap:var(--oc-space-3);color:var(--oc-ink-muted)" role="status">
						<p-progressspinner ariaLabel="Preparing persona draft" data-visual-target="progress-spinner" [style]="{ width: '24px', height: '24px' }" strokeWidth="5" />
						<span>Selecting the reviewed template and linking evidence…</span>
					</div>
				</wo-journey-shell>
			`
		};
	}
};

/** Failed approval leaves the exact reviewed revision inactive and retryable. */
export const PersonaApprovalError: Story =
{
	parameters: { docs: { description: { story: "A failed activation where the exact reviewed draft remains inactive and retryable. It distinguishes a displayable candidate from a persona that an authority has actually made active." } } },
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, personaTones: PersonaArchetypeTones, scores: _PERSONA_SCORES },
			template: `
				<wo-journey-shell title="Your persona is not active yet" description="The reviewed draft remains unchanged. Retry approval when the persona authority is available." [layout]="layouts.Wide">
					<p-message journey-status severity="error" [closable]="false">Approval failed before activation. Future runs still use the previous persona, if any.</p-message>
					<wo-persona-summary componentId="story-persona-approval-error" archetype="The Analyst" [tone]="personaTones.Analyst" description="Methodical, evidence-led, and comfortable naming uncertainty." secondaryInfluence="Anchor" modifier="Explorer" [scores]="scores" />
					<p-button journey-actions label="Back to evidence" severity="secondary" [text]="true" /><p-button journey-actions label="Retry approval" icon="pi pi-refresh" />
				</wo-journey-shell>
			`
		};
	}
};
