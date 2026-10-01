export type ExternalStorybookResourceAllowListEntry = Readonly<{
  kind: "source" | "documentation-asset"
  path: string
}>
