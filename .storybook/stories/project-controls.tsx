import {pickStorybookDirectory} from "../../runtime/directory-picker.ts"
import {createRoot, useState} from "@zavx0z/component"
import {Typography} from "@zavx0z/ui/typography"
import type {Document, HTMLElement} from "@zavx0z/dom"
import {CatalogRegion} from "../../workbench/regions/catalog.tsx"
import type {WorkbenchCatalogAction, WorkbenchCatalogManagement} from "../../workbench/contract.ts"
import {defineSelfStory, serializeSelfElement} from "./story-types.ts"

const initialItems = Object.freeze([
  {id: "project:example-a", label: "Первый проект", route: "/first"},
  {id: "project:example-b", label: "Второй проект", route: "/second"},
])

function ProjectControlsExample(props: Readonly<{document: Document}>) {
  const [items, setItems] = useState<readonly {id: string; label: string; route: string}[]>(initialItems)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState<string | null>(null)
  const [management, setManagement] = useState<WorkbenchCatalogManagement>({
    pending: false, error: "", removableIds: initialItems.map(item => item.id),
  })
  const onAction = async (action: WorkbenchCatalogAction) => {
    if (management.pending) return
    if (action.action === "detach") {
      setItems(items.filter(item => item.id !== action.value))
      if (active === action.value) setActive(null)
      return
    }
    setManagement({...management, pending: true, error: ""})
    try {
      const directory = await pickStorybookDirectory(undefined, "read")
      const id = `example:${directory.name}`
      if (!items.some(item => item.id === id)) setItems([...items, {id, label: directory.name, route: id}])
      setManagement({...management, pending: false, removableIds: [...management.removableIds, id]})
    } catch (error) {
      setManagement({...management, pending: false, error: error instanceof Error && error.name === "AbortError" ? "" : String(error)})
    }
  }
  return <section style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    gap: 8px;
  `}>
    <Typography text="Выберите строку и наведите на неё: крестик находится внутри подсветки. Реальные проекты не изменяются." />
    <div style={css`
      display: flex;
      min-height: 320px;
      flex-grow: 1;
    `}>
      <CatalogRegion
        document={props.document}
        label="Проекты"
        search={search}
        items={items}
        activeId={active}
        management={management}
        onAction={onAction}
        onNavigate={item => setActive(item.id)}
        onSearch={value => setSearch(value)}
        onGroupToggle={() => {}}
      />
    </div>
  </section>
}

export const projects = defineSelfStory(document => {
  const staging = document.createElement("div")
  const root = createRoot(staging)
  root.render(<ProjectControlsExample document={document} />)
  const element = staging.firstElementChild as HTMLElement | null
  if (element === null) {
    root.unmount()
    throw new Error("Project controls example has no element")
  }
  return {
    element,
    root,
    source: {html: serializeSelfElement(element), typescript: JSON.stringify(initialItems, null, 2)},
    props: {example: "Локальные данные для демонстрации UI. Добавление настоящего проекта доступно на главной странице."},
    dispose() { root.unmount() },
  }
})
