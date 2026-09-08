import {WorkbenchNavigationTree} from "../navigation/tree.tsx"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"
import type {WorkbenchNavigationItem} from "../contract.ts"

export type SecondaryRegionProps = Readonly<{
  document: SemanticDocument
  label: string
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
}>

function SecondaryRegionContent(props: Readonly<{value: SecondaryRegionProps}>) {
  const value = props.value
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    flex-grow: 1;
    gap: 2px;
  `}>
    <div
      data-storybook-part="secondary-items"
      style={css`
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex-grow: 1;
      `}
    >
      <WorkbenchNavigationTree
        region="secondary"
        document={value.document}
        query=""
        onGroupToggle={() => {}}
        items={value.items}
        activeId={value.activeId}
        onNavigate={value.onNavigate}
      />
    </div>
  </div>
}

/** Subject navigation for the selected catalog category. */
export function SecondaryRegion(props: SecondaryRegionProps) {
  return <nav
    data-storybook-region="secondary"
    aria-label={props.label}
    style={css`
      display: flex;
      flex: 0 0 152px;
      width: 152px;
      min-height: 0;
    `}
  >
    <WorkbenchRegionPanel>
      <SecondaryRegionContent value={props} />
    </WorkbenchRegionPanel>
  </nav>
}
