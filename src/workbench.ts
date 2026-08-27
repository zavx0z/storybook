/**
Retained five-region Storybook Workbench with one shared lower StatusBar.

The module owns generic catalog, section, preview, dock, and info composition.
Layout mechanics remain direct `@layout/core` contracts, the lower line calls
the exact `@ui/elements/status-bar` owner, and the preview remains a separate
consumer Surface.

@packageDocumentation
*/

export * from "./workbench/layout.ts"
export * from "./workbench/surfaces.ts"
export * from "./workbench/theme.ts"
