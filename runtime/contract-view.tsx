/** Вкладка контракта использует публичный TypeDoc в существующем Display. */
import {TypeDoc} from "@webxr/typedoc"
import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {StorybookContractDocument} from "../catalog/catalog.t.ts"
import {createStorybookComponentPresentation} from "./component-presentation.ts"

type ContractViewProps = Readonly<{documents: readonly StorybookContractDocument[]}>

export function StorybookContractView(props: ContractViewProps) {
  return (
    <section
      data-storybook-contract=""
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
        />
      ))}
    </section>
  )
}

export function createContractPresentation(document: Document, documents: readonly StorybookContractDocument[]) {
  return createStorybookComponentPresentation(
    document,
    StorybookContractView as unknown as CompiledTemplate<ContractViewProps>,
    {documents},
    "[data-storybook-contract]",
  )
}
