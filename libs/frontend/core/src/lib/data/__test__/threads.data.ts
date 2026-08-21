import { MessageCardKind, ThreadData } from "../../models/thread.types";
import { ResourceBoundaryKind } from "../../models/boundary.types";

/** Empty-thread fallback when a session has no fixture. */
export const EMPTY_THREAD: ThreadData =
{
	title: "Thread",
	synced: false,
	pod: "alex.oc",
	dept: "Product",
	deptColor: "#7A6AA0",
	contractVersion: "v2.3.1",
	messages: []
};

/** Demo threads keyed by session id. */
export const THREADS: Record<string, ThreadData> =
{
	t1:
	{
		title: "Q3 strategy draft",
		synced: true,
		pod: "alex.oc",
		dept: "Product",
		deptColor: "#7A6AA0",
		contractVersion: "v2.3.1",
		messages:
		[
			{
				id: "m1",
				role: "user",
				author: "Alex Kim",
				time: "10:14",
				cards: [{ type: MessageCardKind.Text, content: "Can you help me outline the Q3 strategy document? We need to cover growth targets, key initiatives, and resourcing." }]
			},
			{
				id: "m2",
				role: "assistant",
				time: "10:14",
				cards:
				[
					{
						type: MessageCardKind.Text,
						content: `Happy to. Based on what I can see in your product strategy doc and the roadmap, here's a suggested structure:

1. Executive Summary — 2-paragraph thesis on Q3 goals
2. Growth Targets — ARR, new logos, NRR, trial conversion
3. Key Initiatives — ranked by expected impact with owner and timeline
4. Resourcing — headcount plan, contractor budget, cross-team dependencies
5. Risks & Mitigations — top 3 execution risks

Want me to draft any of these in full? I'd suggest starting with section 3 since that's where the trade-offs are.`
					},
					{ type: MessageCardKind.Observation, id: "R1", boundaryKind: ResourceBoundaryKind.Group, label: "ARR target implies 18% QoQ growth", ref: "product-strategy-q3.md" },
					{ type: MessageCardKind.Policy, id: "P1", boundaryKind: ResourceBoundaryKind.Group, label: "Resourcing decisions require VP sign-off", ref: "org_policy.v2.1", status: "applied" }
				]
			},
			{
				id: "m3",
				role: "user",
				author: "Maya Reyes",
				time: "10:21",
				cards: [{ type: MessageCardKind.Text, content: "Draft section 3 — we have four initiatives: PLG expansion, enterprise pilot, data export, and mobile beta." }]
			},
			{
				id: "m4",
				role: "assistant",
				time: "10:22",
				cards:
				[
					{
						type: MessageCardKind.Text,
						content: `Here's section 3. I've ordered them by expected ARR impact rather than effort, which puts Data Export above Mobile Beta despite the mobile beta being further along — the enterprise unblock is just too valuable.

I've also flagged Enterprise Pilot as at-risk because it depends on Data Export hitting Aug 30. If that slips, the pilot timeline collapses. Worth surfacing to the VP now rather than in the Sep 15 review.`
					},
					{ type: MessageCardKind.Action, id: "A1", boundaryKind: ResourceBoundaryKind.Personal, label: "Initiatives table drafted in canvas", ref: "q3-strategy.canvas", status: "done" }
				]
			}
		]
	},
	t3:
	{
		title: "frame-orchard · Interview synthesis",
		synced: false,
		pod: "alex.oc",
		dept: "Product",
		deptColor: "#7A6AA0",
		contractVersion: "v2.3.1",
		messages:
		[
			{
				id: "m1",
				role: "user",
				author: "Maya Reyes",
				time: "09:05",
				cards: [{ type: MessageCardKind.Text, content: "I have notes from 12 user interviews. Can you help me find themes and contradictions across them? I'll paste the raw notes below." }]
			},
			{
				id: "m2",
				role: "assistant",
				time: "09:06",
				cards:
				[{
					type: MessageCardKind.Text,
					content: `Go ahead — paste the notes and I'll synthesise themes, surface tensions, and flag any outliers. A few questions before you do:

— Were these structured interviews with a set script, or more exploratory conversations?
— Do you want output framed around pain points, jobs-to-be-done, or something else?
— Any segments you're specifically trying to compare (e.g. enterprise vs. SMB, power users vs. casual)?

Even rough answers help me calibrate the synthesis.`
				}]
			},
			{
				id: "m3",
				role: "user",
				author: "Maya Reyes",
				time: "09:18",
				cards:
				[{
					type: MessageCardKind.Text,
					content: `Semi-structured. JTBD framing please. Comparing power users vs. casual — that's the main question. Notes incoming:

[Interview 1 - Priya, growth lead]
Main frustration: "I spend 20 min every Monday pulling the same Jira report. I know exactly what I want, I just can't automate it without eng help."
Job: get weekly status without meetings or manual work.

[Interview 2 - Dan, account exec]
"I use it once a week, mostly to prep for customer calls. Feels like a lot of setup for what I need."
Job: look credible in front of a customer in 10 min or less.

[Interview 3 - Sunita, eng lead]
"The context window stuff is annoying. I have to re-explain my project every time."
Job: have a working session where the AI already knows the situation.

[Interview 4 - Karl, ops manager]
"I tried it twice, got confused by the skill setup, left."
Job: get a quick answer without reading a manual.`
				}]
			},
			{
				id: "m4",
				role: "assistant",
				time: "09:19",
				cards:
				[{
					type: MessageCardKind.Text,
					content: `Good data. Here's the synthesis across these four — I'll flag where I'm extrapolating vs. where the notes clearly support the finding.

**Core JTBD split**

Power users (Priya, Sunita) have a recurring, well-defined job: automate a specific workflow they already understand, and maintain context across sessions. They tolerate setup cost if the payoff is reliable.

Casual users (Dan, Karl) have a one-shot job: get a credible output quickly without investment. For them, setup friction is a showstopper, not a trade-off.

**Key tension**
Priya and Sunita are frustrated by things that don't exist yet (automation pipelines, persistent context). Dan and Karl are frustrated by things that do exist but are too complex to discover. These are almost opposite problems — fixing one without acknowledging the other risks alienating both segments.

**Outlier to flag**
Karl left after two sessions. This is a churn signal, not a feature request. If casual users aren't reaching a value moment in the first session, no amount of feature work fixes retention.

**What I'd recommend next**
Split the 12 interviews explicitly into power/casual before theming further — otherwise the average will mislead you. Do you have a signal I could use to classify the remaining 8 (e.g. session frequency, role type)?`
				}]
			}
		]
	},
	t2:
	{
		title: "swift-harbour · Brand refresh",
		synced: true,
		pod: "alex.oc",
		dept: "Marketing",
		deptColor: "#A0855A",
		contractVersion: "v2.3.1",
		messages:
		[
			{
				id: "m1",
				role: "user",
				author: "Alex Kim",
				time: "14:00",
				cards: [{ type: MessageCardKind.Text, content: "We're refreshing the brand for the platform launch. Can you generate some hero image concepts? Something that conveys self-hosted, data-sovereign AI — not generic SaaS stock." }]
			},
			{
				id: "m2",
				role: "assistant",
				time: "14:01",
				cards: [{ type: MessageCardKind.Text, content: "Three directions — each hits data sovereignty differently. I'll generate a representative image for each so you can react to the visual language before we go further." }]
			},
			{
				id: "m3",
				role: "assistant",
				time: "14:02",
				cards:
				[
					{
						type: MessageCardKind.Image,
						imageUrl: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=340&fit=crop&auto=format",
						imageAlt: "Server infrastructure — close-up of rack hardware with warm accent lighting",
						imagePrompt: "Direction A — Infrastructure as asset. Close-up of physical server hardware, warm amber accent light, shallow depth of field. Conveys: you own this, it's real, it's on your premises."
					},
					{
						type: MessageCardKind.Image,
						imageUrl: "https://images.unsplash.com/photo-1639762681057-408e52192e55?w=600&h=340&fit=crop&auto=format",
						imageAlt: "Abstract network graph — nodes and edges on dark background",
						imagePrompt: "Direction B — Knowledge graph. Abstract node-edge network on near-black background, sparse and precise. Conveys: organised intelligence, not chaos."
					},
					{
						type: MessageCardKind.Image,
						imageUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=340&fit=crop&auto=format",
						imageAlt: "Modern open office space — clean, focused, collaborative",
						imagePrompt: "Direction C — People at work. Clean editorial office scene, natural light, people collaborating without the AI being visible. Conveys: this is a tool for real work, not a lab experiment."
					}
				]
			},
			{
				id: "m4",
				role: "user",
				author: "Alex Kim",
				time: "14:09",
				cards: [{ type: MessageCardKind.Text, content: "Direction B is closest but feels too abstract. Can we try something warmer — maybe the same network idea but with more human scale?" }]
			},
			{
				id: "m5",
				role: "assistant",
				time: "14:10",
				cards:
				[
					{ type: MessageCardKind.Text, content: "Good direction. Here's a refined version — same network metaphor but shot from a human perspective, warmer colour temperature, less cold-tech." },
					{
						type: MessageCardKind.Image,
						imageUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=340&fit=crop&auto=format",
						imageAlt: "Team collaborating around a glowing screen showing data visualisation",
						imagePrompt: "Direction B2 — Human-scale network. Team gathered around a warm screen, data visible but not overwhelming, natural expressions. Feels like a tool in daily use."
					},
					{ type: MessageCardKind.Action, id: "A1", boundaryKind: ResourceBoundaryKind.Personal, label: "4 hero concepts saved to brand canvas", ref: "brand-refresh.canvas", status: "done" }
				]
			}
		]
	}
};
