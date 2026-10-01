import {useState} from "@zavx0z/component"
import Panel from "@zavx0z/ui/surface/panel"
import type {ScenarioModel} from "@scenario/model"
/** Форма исходного публичного владельца. */
type ScenarioApp = ScenarioModel.Output
import {ScenarioVariant} from "./variant"

type Variant = ScenarioApp["variants"][number]
type Branch = {id: string; label: string; variant: Variant | null; children: Branch[]}

/** Иерархия исходных describe; порядок вариантов и уникальные id сохраняются. */
function branches(variants: readonly Variant[]): Branch[] {
  const roots: Branch[] = []
  for (const variant of variants) {
    const path = "path" in variant && variant.path?.length ? variant.path : [variant.title]
    let siblings = roots
    for (const [index, label] of path.entries()) {
      const leaf = index === path.length - 1
      const id = leaf ? `variant:${variant.id}` : JSON.stringify(path.slice(0, index + 1))
      let branch = siblings.find(item => item.id === id)
      if (!branch) {
        branch = {id, label, variant: leaf ? variant : null, children: []}
        siblings.push(branch)
      }
      siblings = branch.children
    }
  }
  return roots
}

function ScenarioBranches(props: Readonly<{app: ScenarioApp; items: readonly Branch[]; selectedId: string}>) {
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    `}
  >
    {props.items.map(branch => <ScenarioBranch
      key={branch.id}
      app={props.app}
      branch={branch}
      selectedId={props.selectedId}
    />)}
  </div>
}

/** Группа раскрывается независимо; лист выбирает один исполняемый пример. */
function ScenarioBranch(props: Readonly<{key?: string; app: ScenarioApp; branch: Branch; selectedId: string}>) {
  const [expanded, setExpanded] = useState(true)
  return <>
    {props.branch.variant !== null ? <ScenarioVariant
      app={props.app}
      variant={props.branch.variant!}
      label={props.branch.label}
      expanded={props.selectedId === props.branch.variant!.id}
    /> : <Panel
      label={props.branch.label}
      expanded={expanded}
      onToggle={setExpanded}
    >
      <ScenarioBranches
        app={props.app}
        items={props.branch.children}
        selectedId={props.selectedId}
      />
    </Panel>}
  </>
}

export function ScenarioTree(props: Readonly<{app: ScenarioApp; selectedId: string}>) {
  const items = branches(props.app.variants)
  return <ScenarioBranches
    app={props.app}
    items={items}
    selectedId={props.selectedId}
  />
}
