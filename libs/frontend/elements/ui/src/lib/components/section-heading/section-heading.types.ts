/**
 * The visual hierarchy a section heading contributes inside a route.
 *
 * These states are presentation-only and never grant navigation or access. `Page` is reserved for
 * the top heading of a routed screen, while `Section` keeps the existing subordinate treatment.
 */
export enum SectionHeadingLevels
{
	/** Introduces one region inside an existing page and renders as a second-level heading. */
	Section = "section",
	/** Introduces the routed page itself and renders with the strongest approved heading treatment. */
	Page = "page"
}
