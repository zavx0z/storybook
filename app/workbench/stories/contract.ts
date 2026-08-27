import {
  type Document,
  type HTMLElement,
  type Text,
} from "@zavx0z/dom"
import {
  defineStorybookDomStory,
  type StorybookDomStoryModule,
} from "@zavx0z/storybook/stories"
import {
  STORYBOOK_DOCUMENTATION_MODULES,
  type StorybookDocumentationModuleId,
} from "../../contracts/examples.ts"

type ContractStoryArgs = Record<string, unknown>

type ContractPresentation = Readonly<{
  root: HTMLElement
  title: Text
  summary: Text
  ownership: Text
}>

export function createStorybookContractStory(
  id: StorybookDocumentationModuleId,
): StorybookDomStoryModule<ContractStoryArgs> {
  const contract = STORYBOOK_DOCUMENTATION_MODULES.find((entry) => entry.id === id)
  if (contract === undefined) throw new Error(`Storybook documentation contract not found: ${id}`)
  let presentation: ContractPresentation | null = null

  return defineStorybookDomStory({
    defaultArgs: {},
    render(document, _args, current) {
      if (presentation === null) presentation = createPresentation(document)
      if (current !== null && current !== presentation.root) {
        throw new Error("Contract story received another root")
      }
      presentation.root.setAttribute("data-contract", contract.id)
      presentation.title.data = contract.title
      presentation.summary.data = contract.summary
      presentation.ownership.data = contract.ownership
      return presentation.root
    },
    source() {
      return Object.freeze({
        html: `<article class="contract" data-contract="${escapeHtml(contract.id)}">
  <h2 class="contract__title">${escapeHtml(contract.title)}</h2>
  <p class="contract__summary">${escapeHtml(contract.summary)}</p>
  <h3 class="contract__subtitle">Кто за что отвечает</h3>
  <p class="contract__ownership">${escapeHtml(contract.ownership)}</p>
</article>`,
        css: contractStoryCss,
        typescript: contract.example,
      })
    },
  })
}

const contractStoryCss = `
.contract { display: flex; flex-direction: column; width: 100%; height: 100%; gap: 10px; padding: 22px; border: 1px solid #1a1a1a; border-radius: 6px; color: #e8e8e8; background: #303030; overflow: auto; }
.contract__title { display: block; color: #f4f4f4; font-size: 18px; line-height: 30px; }
.contract__summary, .contract__ownership { display: block; color: #d0d0d0; font-size: 12px; line-height: 22px; white-space: normal; }
.contract__subtitle { display: block; margin-top: 12px; color: #f0f0f0; font-size: 14px; line-height: 24px; }
`.trim()

function createPresentation(document: Document): ContractPresentation {
  const root = document.createElement("article")
  const titleElement = document.createElement("h2")
  const title = document.createTextNode("")
  const summaryElement = document.createElement("p")
  const summary = document.createTextNode("")
  const subtitle = document.createElement("h3")
  const ownershipElement = document.createElement("p")
  const ownership = document.createTextNode("")
  root.className = "contract"
  titleElement.className = "contract__title"
  summaryElement.className = "contract__summary"
  subtitle.className = "contract__subtitle"
  ownershipElement.className = "contract__ownership"
  titleElement.appendChild(title)
  summaryElement.appendChild(summary)
  subtitle.appendChild(document.createTextNode("Кто за что отвечает"))
  ownershipElement.appendChild(ownership)
  root.append(titleElement, summaryElement, subtitle, ownershipElement)
  return Object.freeze({root, title, summary, ownership})
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
