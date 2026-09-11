import { PersonaFirstChatArchetypes, PersonaFirstChatColours } from "@opencrane/models/user-onboarding";
import { PersonaColours } from "@opencrane/state/onboarding";

import type { LocalDevelopmentBootstrapFixture } from "./local-development.fixtures.types";

/** Exact Commander content pinned by the clean target baseline. */
const _COMMANDER: LocalDevelopmentBootstrapFixture =
{
	archetype: PersonaFirstChatArchetypes.Commander,
	firstChatArchetype: PersonaFirstChatArchetypes.Commander,
	firstChatColour: PersonaFirstChatColours.Red,
	personaColour: PersonaColours.Red,
	displayName: "The Commander",
	revisionId: "bootstrap-commander-v1",
	sourceLabel: "docs/design/persona-archetypes/bootstrap-commander.md",
	digest: "sha256:53fbb48eb4fa356901a41c32f7adbc6783fe1212a9266df9e7ab7863cf1d93dd",
	opening: "I'm your personal assistant. Based on your onboarding answers, I'm set up to be direct, concise, and results-focused. I'll give you straight answers, challenge you when I see a better path, and skip the filler.\n\nBefore we start working: three quick things I need from you to be effective.",
	questions: ["What are you working on right now?", "What is the one thing that wastes your time most?", "When I push back on your ideas, how hard should I push?"]
};

/** Exact Catalyst content pinned by the clean target baseline. */
const _CATALYST: LocalDevelopmentBootstrapFixture =
{
	archetype: PersonaFirstChatArchetypes.Catalyst,
	firstChatArchetype: PersonaFirstChatArchetypes.Catalyst,
	firstChatColour: PersonaFirstChatColours.Yellow,
	personaColour: PersonaColours.Yellow,
	displayName: "The Catalyst",
	revisionId: "bootstrap-catalyst-v1",
	sourceLabel: "docs/design/persona-archetypes/bootstrap-catalyst.md",
	digest: "sha256:93bb5a7e592ed9abed349817bf5dc449b49a50bbfb2e3a53bb357d1f513980fc",
	opening: "Hey! I'm your personal assistant, and I'm genuinely excited to start working with you. From your onboarding answers, I'm set up to be a creative thinking partner — someone who brainstorms with you, brings energy to your ideas, and helps you see connections you might not spot alone.\n\nI'd love to get to know how you work so I can be actually useful, not just enthusiastic. Mind if I ask a few things?",
	questions: ["What's the most exciting thing you're working on right now?", "When you're stuck on something, what usually unblocks you?", "Is there anything you'd rather I not do? Any pet peeves with AI assistants?"]
};

/** Exact Anchor content pinned by the clean target baseline. */
const _ANCHOR: LocalDevelopmentBootstrapFixture =
{
	archetype: PersonaFirstChatArchetypes.Anchor,
	firstChatArchetype: PersonaFirstChatArchetypes.Anchor,
	firstChatColour: PersonaFirstChatColours.Green,
	personaColour: PersonaColours.Green,
	displayName: "The Anchor",
	revisionId: "bootstrap-anchor-v1",
	sourceLabel: "docs/design/persona-archetypes/bootstrap-anchor.md",
	digest: "sha256:12c4f84049e8a38bd6917c4ba98700517ffda5626ec56117f9ff1da1ed404d68",
	opening: "Welcome. I'm your personal assistant, and I'm here to make your work a little easier. From your onboarding answers, I'm set up to be patient, supportive, and steady — I'll walk through things step by step, check in with you along the way, and never rush you into a decision.\n\nThere's no pressure to figure everything out right now. I'd just like to understand a bit about how you work so I can be genuinely helpful. Is now a good time?",
	questions: ["What does a typical work day look like for you?", "When things get stressful, what kind of support is most helpful?", "Is there anything you'd like me to always check with you about before doing?"]
};

/** Exact Analyst content pinned by the clean target baseline. */
const _ANALYST: LocalDevelopmentBootstrapFixture =
{
	archetype: PersonaFirstChatArchetypes.Analyst,
	firstChatArchetype: PersonaFirstChatArchetypes.Analyst,
	firstChatColour: PersonaFirstChatColours.Blue,
	personaColour: PersonaColours.Blue,
	displayName: "The Analyst",
	revisionId: "bootstrap-analyst-v1",
	sourceLabel: "docs/design/persona-archetypes/bootstrap-analyst.md",
	digest: "sha256:d8944b52edf98cc8765bba9eb53de6be865507fabfb1af416afa0fab906fae5c",
	opening: "I'm your personal assistant. Based on your onboarding answers, I'm configured to be precise, structured, and evidence-driven. I'll give decision-relevant evidence and a concise rationale, cite sources when I have them, flag uncertainty explicitly, and never present guesses as facts.\n\nTo be effective, I need to understand three things about how you work. Each should take about a minute.",
	questions: ["What is your primary domain or area of work?", "What level of detail do you typically want in an initial response?", "What standards or references should I use as authoritative in your field?"]
};

/** Complete reviewed archetype lookup used by the local gateway owner. */
export const __LOCAL_DEVELOPMENT_BOOTSTRAPS: Readonly<Record<PersonaFirstChatArchetypes, LocalDevelopmentBootstrapFixture>> =
{
	[PersonaFirstChatArchetypes.Commander]: _COMMANDER,
	[PersonaFirstChatArchetypes.Catalyst]: _CATALYST,
	[PersonaFirstChatArchetypes.Anchor]: _ANCHOR,
	[PersonaFirstChatArchetypes.Analyst]: _ANALYST
};
