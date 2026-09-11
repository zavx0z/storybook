import {createContractPresentation} from "../../runtime/contract-view.tsx"
import {defineSelfStory, serializeSelfElement} from "./story-types.ts"
import type {StorybookContractDocument} from "../../catalog/catalog.t.ts"

/** Показывает вход по умолчанию тем же TypeDoc, что и вкладка структурного контракта. */
export const typeContractExample = defineSelfStory(document => {
  const documents: readonly StorybookContractDocument[] = [{
    direction: "input",
    document: {name: "input.ts", declarations: [{
      name: "ExampleInput", kind: "interface", signature: "export interface ExampleInput { label: string; disabled?: boolean }",
      comment: {summary: "Входные данные компонента.", examples: []},
      members: [
        {name: "label", type: "string", optional: false, description: "Текст для отображения."},
        {name: "disabled", type: "boolean | undefined", optional: true, defaultValue: "false", description: "Блокирует действие, сохраняя элемент."},
      ],
    }]},
  }, {
    direction: "output",
    document: {name: "output.ts", declarations: [{
      name: "ExampleOutput", kind: "type", signature: "export type ExampleOutput = { accepted: boolean }",
      comment: {summary: "Результат операции.", examples: []},
      members: [{name: "accepted", type: "boolean", optional: false, description: "Показывает, было ли принято действие."}],
    }]},
  }]
  const presentation = createContractPresentation(document, documents)
  return {
    element: presentation.element,
    root: presentation.componentRoot,
    source: {html: serializeSelfElement(presentation.element), typescript: JSON.stringify(documents, null, 2)},
    props: {name: "ExampleInput"},
    dispose: presentation.dispose,
  }
})
