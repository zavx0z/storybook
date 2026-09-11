/** Вкладка контракта использует публичный TypeDoc в существующем Display. */
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

type ContractViewProps = Readonly<{
  documents: readonly StorybookContractDocument[]
  onReady?: StorybookContractNavigationReady | undefined
  onScroll?: (() => void) | undefined
}>

export function StorybookContractView(props: ContractViewProps) {
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
      {props.documents.map(entry => (
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
) {
  return createStorybookComponentPresentation(
    document,
    StorybookContractView as unknown as CompiledTemplate<ContractViewProps>,
    {documents, onReady, onScroll},
    "[data-storybook-contract]",
  )
}
