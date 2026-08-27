export const STORYBOOK_STATUS_BAR_META_NAMES = Object.freeze({
  lead: "storybook-status-bar-lead",
  owner: "storybook-status-bar-owner",
  detail: "storybook-status-bar-detail",
})

export type InjectedStorybookStatusBar = Readonly<{
  lead: string
  owner: string
  detail: string
}>

/** Reads the owner-supplied status text injected by the shared page shell. */
export function readInjectedStorybookStatusBar(documentRef: Document = document): InjectedStorybookStatusBar {
  return Object.freeze({
    lead: readRequiredMeta(documentRef, STORYBOOK_STATUS_BAR_META_NAMES.lead),
    owner: readRequiredMeta(documentRef, STORYBOOK_STATUS_BAR_META_NAMES.owner),
    detail: readRequiredMeta(documentRef, STORYBOOK_STATUS_BAR_META_NAMES.detail),
  })
}

function readRequiredMeta(documentRef: Document, name: string): string {
  const value = [...documentRef.querySelectorAll<HTMLMetaElement>("meta")]
    .find((meta) => meta.name === name)?.content.trim() ?? ""
  if (value.length === 0) throw new Error(`Storybook page is missing ${name} meta`)
  return value
}
