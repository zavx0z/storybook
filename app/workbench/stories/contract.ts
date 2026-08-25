/**
UI-rendered documentation story for one public Storybook contract.

The preview uses exact production Pane and text elements. The right Workbench
panel receives the same registry-owned import example as its source.

@packageDocumentation
*/

import {Pane} from "@ui/components/pane"
import {h2, h3, p} from "@ui/elements/text"
import {
  defineStorybookStoryModule,
  type StorybookStoryModule,
} from "@zavx0z/storybook/stories"
import {
  STORYBOOK_DOCUMENTATION_MODULES,
  type StorybookDocumentationModuleId,
} from "../../contracts/examples.ts"

/** Creates one package-owned contract page inside the universal Workbench. */
export function createStorybookContractStory(
  id: StorybookDocumentationModuleId,
): StorybookStoryModule {
  const contract = STORYBOOK_DOCUMENTATION_MODULES.find((entry) => entry.id === id)
  if (contract === undefined) throw new Error(`Storybook documentation contract not found: ${id}`)

  return defineStorybookStoryModule({
    defaultArgs: {},
    controls: [],
    render(surface, _args, frame) {
      const inset = Math.max(18, Math.min(32, frame.w * 0.05))
      const x = frame.x + inset
      const y = frame.y + 84
      const width = Math.max(1, frame.w - inset * 2)
      const height = Math.max(1, frame.h - 116)
      Pane(surface, x, y, width, height, {appearance: "panel"})
      h2(surface, x + 22, y + 22, width - 44, 30, {children: contract.title})
      const summaryBottom = drawWrappedParagraph(surface, contract.summary, x + 22, y + 62, width - 44)
      h3(surface, x + 22, summaryBottom + 22, width - 44, 24, {children: "Кто за что отвечает"})
      drawWrappedParagraph(surface, contract.ownership, x + 22, summaryBottom + 58, width - 44)
    },
    source() {
      return contract.example
    },
  })
}

function drawWrappedParagraph(
  surface: Parameters<typeof p>[0],
  text: string,
  x: number,
  y: number,
  width: number,
): number {
  const lines = wrapText(surface, text, width, 12)
  for (const [index, line] of lines.entries()) {
    p(surface, x, y + index * 22, width, 20, {children: line})
  }
  return y + lines.length * 22
}

function wrapText(
  surface: Parameters<typeof p>[0],
  text: string,
  width: number,
  fontPx: number,
): readonly string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/u)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (line.length > 0 && surface.measureText(candidate, fontPx) > width) {
      lines.push(line)
      line = word
    } else line = candidate
  }
  if (line.length > 0) lines.push(line)
  return Object.freeze(lines)
}
