/** Вкладка контракта использует публичный TypeDoc в существующем Display. */
import {useLayoutEffect, useState} from "@immersive/component"
import {TypeDoc} from "@immersive/typedoc"
import type {Document} from "@immersive/dom"
import type {CompiledTemplate} from "@immersive/template/compiled"
import type {StorybookContractDocument} from "../contract/documents.ts"
import createStorybookComponentPresentation from "@storybook-app-web-page/presentation"

import type {StorybookContractNavigationReady, StorybookContractSelection} from "../contract/contract-view"

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
          title={entry.direction === "input" ? "Входные данные" : entry.direction === "output" ? "Выходные данные" : "Слоты"}
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
