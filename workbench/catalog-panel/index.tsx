/**
Общая панель каталога Display и Minimap: поиск, текущее место, раскрытие дерева
и управление подключёнными проектами. Навигация использует один каталог Workbench;
управление видимостью принадлежит принимающему Window.

@packageDocumentation
*/
import TextField, {type TextFieldProps} from "@zavx0z/ui/field/text-field"
import Button from "@zavx0z/ui/button/button"
import {collapseAllIcon, expandAllIcon, plusIcon, selectOpenedItemIcon} from "@zavx0z/ui/theme/icon"
import {useRef} from "@zavx0z/component"
import {WorkbenchNavigationTree, type WorkbenchNavigationTreeHandle} from "../navigation/ui-tree.tsx"
import type {CatalogPanelProps} from "./contract/input.ts"
export type {CatalogPanelProps} from "./contract/input.ts"

/** Показывает готовый каталог через общий Tree и передаёт действия его владельцу. */
export function CatalogPanel(value: CatalogPanelProps) {
  const tree = useRef<WorkbenchNavigationTreeHandle | null>(null)
  const onSearch: NonNullable<TextFieldProps["onInput"]> = (search, event) => {
    value.onSearch(search, event.currentTarget)
  }
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    flex-grow: 1;
    gap: 2px;
  `}>
    <div
      data-storybook-part="catalog-search"
      style={css`
        display: flex;
        align-items: center;
        width: 100%;
        height: 24px;
        gap: 4px;
      `}
    >
      <TextField
        type="search"
        value={value.search}
        placeholder="Поиск…"
        title="Поиск по каталогу"
        aria-label="Поиск по каталогу"
        style={css`
          flex: 1;
          min-width: 0;
          --text-field-width: 100%;
        `}
        onInput={onSearch}
      />
      <Button
        label=""
        startIcon={selectOpenedItemIcon}
        title="Найти текущую страницу в дереве"
        aria-label="Найти текущую страницу в дереве"
        disabled={value.activeId === null}
        onClick={event => tree.current?.revealActive(event.currentTarget)}
        style={css`
          flex-shrink: 0;
        `}
      />
      <Button
        label=""
        startIcon={expandAllIcon}
        title="Развернуть всё дерево"
        aria-label="Развернуть всё дерево"
        onClick={() => tree.current?.expandAll()}
        style={css`
          flex-shrink: 0;
        `}
      />
      <Button
        label=""
        startIcon={collapseAllIcon}
        title="Свернуть всё дерево"
        aria-label="Свернуть всё дерево"
        onClick={() => tree.current?.collapseAll()}
        style={css`
          flex-shrink: 0;
        `}
      />
      {value.management !== null ? <Button
        label=""
        startIcon={plusIcon}
        title="Добавить проект"
        aria-label="Добавить проект"
        disabled={value.management.pending}
        onClick={event => value.onAction({action: "attach"}, event.currentTarget)}
        style={css`
          flex-shrink: 0;
        `}
      /> : null}
    </div>
    <p
      hidden={value.management === null || value.management.error === ""}
      role="status"
      style={css`
        margin: 0;
        white-space: normal;

        &[hidden] {
          display: none;
        }
      `}
    >{value.management?.error ?? ""}</p>
    <div
      data-storybook-part="catalog-items"
      style={css`
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex-grow: 1;
      `}
    >
      <WorkbenchNavigationTree
        items={value.items}
        activeId={value.activeId}
        query={value.search}
        onNavigate={value.onNavigate}
        onGroupToggle={value.onGroupToggle}
        onSearch={value.onSearch}
        onReady={handle => { tree.current = handle }}
        navigationExpansion={value.navigationExpansion}
        removableIds={value.management?.removableIds ?? []}
        onRemove={(item, source) => value.onAction({action: "detach", value: item.id}, source)}
      />
    </div>
  </div>
}
