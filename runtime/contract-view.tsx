/** Вкладка контракта использует публичный TypeDoc в существующем Display. */
import {useLayoutEffect, useState} from "@zavx0z/component"
import {TypeDoc, type TypeDocProps} from "@webxr/typedoc"
import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {StorybookContractDocument} from "../catalog/catalog.t.ts"
import {createStorybookComponentPresentation} from "./component-presentation.ts"

/** Передаёт владельцу вкладки навигатор текущего направления; null отзывает его при unmount. */
export type StorybookContractNavigationReady = (
  direction: StorybookContractDocument["direction"],
  navigation: Parameters<NonNullable<TypeDocProps["onReady"]>>[0],
) => void

/** Передаёт выбор направления из URL и Inspector в существующий Display. */
export type StorybookContractSelection = Readonly<{
  initial: StorybookContractDocument["direction"]
  subscribe(listener: (direction: StorybookContractDocument["direction"]) => void): () => void
}>

type ContractViewProps = Readonly<{
  documents: readonly StorybookContractDocument[]
  selection?: StorybookContractSelection | undefined
  onReady?: StorybookContractNavigationReady | undefined
  onScroll?: (() => void) | undefined
}>

export function StorybookContractView(props: ContractViewProps) {
  const [direction, setDirection] = useState(props.selection?.initial ?? props.documents[0]?.direction ?? "input")
  useLayoutEffect(() => props.selection?.subscribe(setDirection), [props.selection])
  return (
    <section
      data-storybook-contract=""
      onScroll={event => {
        if (event.target === event.currentTarget) props.onScroll?.()
      }}
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        padding: 16px;
        gap: 24px;
      `}
    >
      {props.documents.filter(entry => entry.direction === direction).map(entry => (
        <TypeDoc
          key={entry.direction}
          document={entry.document}
          title={entry.direction === "input" ? "Входные данные" : "Выходные данные"}
          onReady={navigation => props.onReady?.(entry.direction, navigation)}
        />
      ))}
    </section>
  )
}

export function createContractPresentation(
  document: Document,
  documents: readonly StorybookContractDocument[],
  onReady?: StorybookContractNavigationReady,
  onScroll?: () => void,
  selection?: StorybookContractSelection,
) {
  return createStorybookComponentPresentation(
    document,
    StorybookContractView as unknown as CompiledTemplate<ContractViewProps>,
    {documents, onReady, onScroll, selection},
    "[data-storybook-contract]",
  )
}
