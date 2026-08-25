/**
Retained five-region Storybook Workbench infrastructure.

The module owns generic catalog, section, preview, dock, and info composition.
Layout mechanics remain direct `@layout/core` contracts, visual primitives
remain direct UI owners, and the preview remains a separate consumer Surface.

@packageDocumentation
*/

export * from "./workbench/layout.ts"
export * from "./workbench/surfaces.ts"
export * from "./workbench/theme.ts"
