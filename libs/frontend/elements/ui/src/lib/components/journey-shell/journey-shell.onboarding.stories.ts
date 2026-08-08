import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ChoiceCardGroupComponent } from "../choice-card-group/choice-card-group.component";
import { ChoiceCardLayouts, ChoiceCardOption } from "../choice-card-group/choice-card-group.types";
import { CollapsibleSectionComponent } from "../collapsible-section/collapsible-section.component";
import { ScopeChipComponent } from "../scope-chip/scope-chip.component";
import { ScopeChipAppearances, ScopeChipTones } from "../scope-chip/scope-chip.types";
import { JourneyShellComponent } from "./journey-shell.component";
import { JourneyShellLayouts } from "./journey-shell.types";

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

/** Storybook metadata for persona survey and review states. */
const meta: Meta<JourneyShellComponent> =
{
	title: "Foundation/Journey shell",
	component: JourneyShellComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [ButtonModule, ChoiceCardGroupComponent, CollapsibleSectionComponent, MessageModule, ScopeChipComponent] })]
};

export default meta;

/** Local Storybook story type for onboarding journeys. */
type Story = StoryObj<JourneyShellComponent>;

/** Ten-question onboarding composition using the shared choice-card contract. */
export const OnboardingQuestion: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, choiceLayouts: ChoiceCardLayouts, options: _ONBOARDING_OPTIONS },
			template: `
				<wo-journey-shell title="How should your agent help when a decision is unclear?" description="Choose the answer that feels most natural. Your agent will explain what it inferred before anything becomes active." [layout]="layouts.Compact">
					<div journey-eyebrow style="margin-bottom:var(--oc-space-3);font:500 var(--oc-text-xs) var(--oc-font-mono);color:var(--oc-accent);text-transform:uppercase;letter-spacing:var(--oc-tracking-label)">Persona sorting</div>
					<div journey-progress style="display:grid;gap:var(--oc-space-2);margin-top:var(--oc-space-5)" role="progressbar" aria-label="Persona sorting progress" aria-valuemin="0" aria-valuemax="10" aria-valuenow="6"><div style="display:flex;justify-content:space-between;font:400 var(--oc-text-xs) var(--oc-font-mono);color:var(--oc-ink-muted)"><span>Question 6 of 10</span><span>60%</span></div><div style="height:var(--oc-space-1);border-radius:var(--oc-radius-round);background:var(--oc-neutral-soft);overflow:hidden"><span style="display:block;width:60%;height:100%;background:var(--oc-accent)"></span></div></div>
					<wo-choice-card-group controlId="story-persona-question" legend="Choose one answer" [options]="options" selectedId="recommend" [layout]="choiceLayouts.Grid" />
					<p-button journey-actions label="Back" severity="secondary" [text]="true" /><p-button journey-actions label="Continue" icon="pi pi-arrow-right" iconPos="right" />
				</wo-journey-shell>`
		};
	}
};

/** Tied score is unresolved until the owner chooses one exact candidate. */
export const TiedScoreResolution: Story =
{
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
	tags: ["visual-test"],
	render: function render()
	{
		return {
			props: { layouts: JourneyShellLayouts, tones: ScopeChipTones, appearances: ScopeChipAppearances },
			template: `
				<wo-journey-shell title="Your starting persona" description="Review the result and the evidence behind it before this persona becomes active." [layout]="layouts.Wide">
					<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(16rem,.9fr);gap:var(--oc-space-6)">
						<section style="padding:var(--oc-space-6);border:1px solid var(--oc-border-default);border-radius:var(--oc-radius-card);background:var(--oc-surface-raised)"><wo-scope-chip label="Primary archetype" [tone]="tones.Info" [appearance]="appearances.Soft" /><h2 style="margin:var(--oc-space-3) 0 var(--oc-space-2);font-size:var(--oc-text-4xl);font-weight:500;color:var(--oc-archetype-analyst)">Analyst</h2><p style="margin:0;color:var(--oc-ink-muted);line-height:1.6">Methodical, evidence-led, and comfortable naming uncertainty. Secondary influence: Anchor. Modifier: Explorer.</p><div style="display:grid;gap:var(--oc-space-3);margin-top:var(--oc-space-6)"><div role="meter" aria-label="Analyst score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="38"><div style="display:flex;justify-content:space-between"><span>Analyst</span><span>38%</span></div><div style="height:var(--oc-space-2);margin-top:var(--oc-space-1);border-radius:var(--oc-radius-round);background:var(--oc-neutral-soft);overflow:hidden"><span style="display:block;width:38%;height:100%;background:var(--oc-archetype-analyst)"></span></div></div><div role="meter" aria-label="Anchor score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="29"><div style="display:flex;justify-content:space-between"><span>Anchor</span><span>29%</span></div><div style="height:var(--oc-space-2);margin-top:var(--oc-space-1);border-radius:var(--oc-radius-round);background:var(--oc-neutral-soft);overflow:hidden"><span style="display:block;width:29%;height:100%;background:var(--oc-archetype-anchor)"></span></div></div><div role="meter" aria-label="Commander score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="18"><div style="display:flex;justify-content:space-between"><span>Commander</span><span>18%</span></div><div style="height:var(--oc-space-2);margin-top:var(--oc-space-1);border-radius:var(--oc-radius-round);background:var(--oc-neutral-soft);overflow:hidden"><span style="display:block;width:18%;height:100%;background:var(--oc-archetype-commander)"></span></div></div><div role="meter" aria-label="Catalyst score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="15"><div style="display:flex;justify-content:space-between"><span>Catalyst</span><span>15%</span></div><div style="height:var(--oc-space-2);margin-top:var(--oc-space-1);border-radius:var(--oc-radius-round);background:var(--oc-neutral-soft);overflow:hidden"><span style="display:block;width:15%;height:100%;background:var(--oc-archetype-catalyst)"></span></div></div></div></section>
						<div style="display:grid;align-content:start;gap:var(--oc-space-3)"><wo-collapsible-section sectionId="story-result-evidence" title="Why this result"><ul style="margin:0;padding:0 var(--oc-space-6);color:var(--oc-ink-muted);line-height:1.7"><li>You asked for sources before confidence.</li><li>You prefer explicit trade-offs.</li><li>You keep alternatives visible.</li></ul></wo-collapsible-section><wo-collapsible-section sectionId="story-soul-preview" title="SOUL preview" [defaultOpen]="false"><p style="margin:0;padding:0 var(--oc-space-4);color:var(--oc-ink-muted)">I will separate observed evidence from inference.</p></wo-collapsible-section></div>
					</div>
					<p-button journey-actions label="Sort again" severity="secondary" [text]="true" /><p-button journey-actions label="Approve persona" icon="pi pi-check" />
				</wo-journey-shell>`
		};
	}
};
