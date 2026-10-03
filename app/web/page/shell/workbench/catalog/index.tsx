/**
Общая панель каталога Display и Minimap: поиск, текущее место, раскрытие дерева
и управление Repo проекта. Навигация использует один каталог Workbench;
управление видимостью принадлежит принимающему Window. Minimap добавляет в строку
поиска кнопку пересборки Web со значком; ошибка действия показывается под строкой.
Добавление и удаление Repo показаны отключёнными до реализации операций Project.

@packageDocumentation
*/
import {TextField, type UiFieldsTextField} from "@zavx0z/ui"
import {Button} from "@zavx0z/ui"
import {collapseAllIcon, expandAllIcon, plusIcon, selectOpenedItemIcon} from "@ui-themes/icons"
import {useRef} from "@zavx0z/component"
import {CatalogNavigationTree, type CatalogNavigationTreeHandle} from "./src/navigation-tree"
import {rebuildIcon} from "./src/icons"
import type {WebCatalog} from "./contract"
export type {WebCatalog} from "./contract"

/** Показывает готовый каталог через общий Tree и передаёт действия его владельцу. */
export default function CatalogPanel(value: WebCatalog.Input) {
  const tree = useRef<CatalogNavigationTreeHandle | null>(null)
  const onSearch: NonNullable<UiFieldsTextField.Input["onInput"]> = (search, event) => {
    value.onSearch(search, event.currentTarget)
  }
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      flex-grow: 1;
      gap: 2px;
    `}
  >
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
      {value.webRebuild !== undefined ? <Button
        label=""
        startIcon={rebuildIcon}
        title={value.webRebuild.busy ? "Пересборка интерфейса…" : "Пересобрать интерфейс"}
        aria-label="Пересобрать интерфейс"
        disabled={value.webRebuild.busy}
        onClick={() => value.webRebuild?.onClick()}
        style={css`
          flex-shrink: 0;
        `}
      /> : null}
      {value.management !== null ? <Button
        label=""
        startIcon={plusIcon}
        title="Добавить репозиторий"
        aria-label="Добавить репозиторий"
        disabled
        onClick={event => value.onAction({action: "attach"}, event.currentTarget)}
        style={css`
          flex-shrink: 0;
        `}
      /> : null}
    </div>
    <p
      hidden={!value.webRebuild?.error}
      role="alert"
      style={css`
        margin: 0;
        white-space: normal;
        color: var(--state-error);

        &[hidden] {
          display: none;
        }
      `}
    >{value.webRebuild?.error ?? ""}</p>
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
      <CatalogNavigationTree
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
