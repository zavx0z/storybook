import {Tree, type TreeItem, type TreeHandle} from "@zavx0z/ui/widgets/tree"
import {uiIcons} from "@zavx0z/ui/themes/icons"
import {useLayoutEffect, useRef, useState} from "@zavx0z/component"
import type {StorybookContractDocument} from "../catalog/catalog.t.ts"
import type {WorkbenchInspectorCustomWidgetProps} from "../workbench/contract.ts"

/** Точная декларация TypeDoc из transport контракта Storybook. */
type ContractDeclaration = StorybookContractDocument["document"]["declarations"][number]

/** Точное поле TypeDoc, включая вложенные children parser при их наличии. */
type ContractMember = ContractDeclaration["members"][number]

/** Данные оглавления и действия над тем же отображаемым контрактом, без копии документа. */
type ContractOutlineValue = StorybookContractDocument & Readonly<{
  navigate(declaration: string, path: readonly string[]): boolean
  locate(): Readonly<{declaration: string; path: readonly string[]}> | null
  subscribeLocation(listener: (location: Readonly<{declaration: string; path: readonly string[]}> | null) => void): () => void
}>

/**
Показывает фактическую структуру одного входного или выходного контракта.

Значение приходит из уже проверенного снимка TypeDoc. Компонент не разбирает
TypeScript-строки: вложенность берётся только из `TypeDocMember.children`.
Раскрытие принадлежит workspace Inspector и передаётся через общий custom-widget
contract, поэтому сохраняется при возврате на вкладку контракта.

@param props - Контрактный документ и состояние раскрытия, предоставленные
Workbench для текущей секции Inspector.
*/
export function StorybookContractOutline(props: WorkbenchInspectorCustomWidgetProps) {
  const document = props.value as ContractOutlineValue
  const items = contractOutlineItems(document)
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])
  const tree = useRef<TreeHandle | null>(null)
  const pendingReveal = useRef<string | null>(null)
  const lastLocation = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (pendingReveal.current !== null && tree.current !== null) {
      tree.current.reveal(pendingReveal.current)
      pendingReveal.current = null
    }
  }, [props.expandedKeys, selectedKeys])
  const navigate = (id: string) => {
    const [, declaration, ...path] = JSON.parse(id) as string[]
    if (declaration !== undefined && document.navigate(declaration, path)) setSelectedKeys([id])
  }
  const reveal = (location: ReturnType<ContractOutlineValue["locate"]>) => {
    if (location === null) return
    const parts = [document.direction, location.declaration, ...location.path]
    const id = treeItemId(...parts)
    if (lastLocation.current === id) return
    lastLocation.current = id
    const ancestors = location.path.map((_, index) => treeItemId(...parts.slice(0, index + 2)))
    pendingReveal.current = id
    props.onExpandedChange([...new Set([...props.expandedKeys, ...ancestors])])
    setSelectedKeys([id])
  }
  useLayoutEffect(() => {
    lastLocation.current = null
    setSelectedKeys([])
    return document.subscribeLocation(reveal)
  }, [document])
  return <Tree
    title={document.direction === "input" ? "Входные поля" : "Выходные поля"}
    items={items}
    expandedKeys={props.expandedKeys}
    selectedKeys={selectedKeys}
    emptyLabel="В контракте нет полей"
    actions={[
      {
        id: "collapse-all",
        label: "Свернуть всё",
        iconSrc: uiIcons.collapse,
        onAction: () => props.onExpandedChange([]),
      },
      {
        id: "expand-all",
        label: "Развернуть всё",
        iconSrc: uiIcons.expand,
        onAction: () => props.onExpandedChange(expandableKeys(items)),
      },
    ]}
    onExpandedChange={keys => props.onExpandedChange(keys)}
    onSelectionChange={keys => { if (keys[0] !== undefined) navigate(keys[0]) }}
    onActivate={navigate}
    onReady={handle => { tree.current = handle }}
    style={css`
      min-height: 160px;
    `}
  />
}

/**
Собирает все раскрываемые строки, включая пока скрытые вложенные ветви.

@param items - Дерево текущего направления контракта.
@returns Ключи только строк с дочерними элементами; соседняя секция не меняется.
*/
function expandableKeys(items: readonly TreeItem[]): readonly string[] {
  return items.flatMap(item => item.children?.length
    ? [item.id, ...expandableKeys(item.children)]
    : [])
}

/**
Проецирует только декларации с полями в корни Tree.

Пустая декларация не маскирует отсутствие структуры отдельной строкой: при
отсутствии полей `Tree.emptyLabel` показывает явное состояние секции.

@param document - Exact TypeDoc одного `contract/input.ts` или `contract/output.ts`.

@returns Корневые декларации с дочерними полями в порядке parser snapshot.
*/
function contractOutlineItems(document: StorybookContractDocument): readonly TreeItem[] {
  return Object.freeze(document.document.declarations
    .filter(declaration => declaration.members.length > 0)
    .map(declaration => Object.freeze({
    id: treeItemId(document.direction, declaration.name),
    label: declaration.name,
    detail: declaration.kind,
    title: declaration.comment.summary || declaration.signature,
    children: contractMemberItems(document.direction, declaration, declaration.members, []),
    })))
}

/**
Рекурсивно переносит поля TypeDoc в Tree без разбора или переопределения типа.

@param direction - Направление исходного contract file; входит в identity дерева.

@param declaration - Exported interface или type, которому принадлежат поля.

@param members - Уже разрешённые parser поля текущего уровня.

@param ancestors - Имена родительских полей от корня declaration до current level.

@returns Tree-строки с уникальным сериализованным путём и вложенными children.
*/
function contractMemberItems(
  direction: StorybookContractDocument["direction"],
  declaration: ContractDeclaration,
  members: readonly ContractMember[],
  ancestors: readonly string[],
): readonly TreeItem[] {
  return Object.freeze(members.map(member => {
    const path = [...ancestors, member.name]
    const children = contractMemberItems(direction, declaration, nestedMembers(member), path)
    return Object.freeze({
      id: treeItemId(direction, declaration.name, ...path),
      label: `${member.name}${member.optional ? "?" : ""}`,
      title: `${member.type}${member.description ? `\n${member.description}` : ""}`,
      ...(children.length === 0 ? {} : {children}),
    })
  }))
}

/**
Возвращает вложенные поля из общего TypeDoc transport без строкового анализа.

@param member - Поле текущего уровня из declaration snapshot.

@returns Вложенные поля либо пустой массив для скаляра и нераскрываемого типа.
*/
function nestedMembers(member: ContractMember): readonly ContractMember[] {
  return member.children ?? Object.freeze([])
}

/**
Создаёт injective Tree identity из частей exact contract пути.

JSON-массив отличает буквальное имя `a.b` от последовательности `a`, `b`,
поэтому retained expanded keys не смешивают разные поля одного документа.

@param parts - Направление, declaration и последовательность имён полей.

@returns Сериализованный не пустой идентификатор TreeItem.
*/
function treeItemId(...parts: readonly string[]): string {
  return JSON.stringify(parts)
}
