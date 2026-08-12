// Public API of @opencrane/elements/a2ui.
//
// This package only DISPLAYS A2UI surfaces, and only the components listed in
// A2uiComponentNames. A host component passes in one A2uiSurfacePresentation and forwards the
// A2uiDisplayedActionIntent values this package emits to the server, which alone decides whether
// to act on them. Nothing here reads a raw provider payload, and nothing here can run a command.
//
// Start at A2uiCanvasComponent (the element a host renders), then a2ui.types.ts for the two
// shapes crossing the boundary, then a2ui.providers.ts for what the host must provide.
//
// The upstream component and operation shapes are the A2UI v0.8 specification, which is what
// @a2ui/web_core 0.10.3 ships and what the `@a2ui/angular/v0_8` import path pins. Upstream marks
// v0.8 legacy, so check the spec revision before bumping the dependency:
// https://a2ui.org/specification/v0.8-a2ui/
export * from "./lib/a2ui-canvas.component.js";
export * from "./lib/a2ui.providers.js";
export * from "./lib/a2ui.types.js";
