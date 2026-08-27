import {
  type HTMLButtonElement,
  type Text,
} from "@zavx0z/dom"
import {
  defineStorybookDomStory,
  type StorybookDomStoryModule,
} from "@zavx0z/storybook/stories"

export type StorybookWorkbenchButtonArgs = Record<string, unknown> & Readonly<{
  variant: "contained" | "outlined" | "glass"
  disabled: boolean
}>

type ButtonPresentation = Readonly<{
  element: HTMLButtonElement
  text: Text
}>

export function createStorybookWorkbenchButtonStory(
  preset: Pick<StorybookWorkbenchButtonArgs, "variant" | "disabled">,
): StorybookDomStoryModule<StorybookWorkbenchButtonArgs> {
  let presentation: ButtonPresentation | null = null

  return defineStorybookDomStory({
    defaultArgs: {
      variant: preset.variant,
      disabled: preset.disabled,
    },
    render(document, args, current) {
      if (presentation === null) {
        const element = document.createElement("button")
        const text = document.createTextNode("")
        element.type = "button"
        element.title = "Проверить DOM story"
        element.appendChild(text)
        presentation = Object.freeze({element, text})
      }
      if (current !== null && current !== presentation.element) {
        throw new Error("Button story received another root")
      }
      presentation.element.className = `documentation-button documentation-button--${args.variant}`
      presentation.element.disabled = args.disabled
      presentation.text.data = "Проверить пример"
      return presentation.element
    },
    source(args) {
      return Object.freeze({
        html: `<button class="documentation-button documentation-button--${args.variant}" type="button" title="Проверить DOM story"${args.disabled ? " disabled" : ""}>Проверить пример</button>`,
        css: buttonStoryCss,
        typescript: [
          'const button = document.createElement("button")',
          'button.type = "button"',
          'button.textContent = "Проверить пример"',
          'button.title = "Проверить DOM story"',
          `button.className = "documentation-button documentation-button--${args.variant}"`,
          ...(args.disabled ? ["button.disabled = true"] : []),
          'button.addEventListener("click", () => console.log("Нажатие"))',
        ].join("\n"),
      })
    },
  })
}

const buttonStoryCss = `
.documentation-button { display: block; width: 240px; height: 40px; padding: 8px 14px; border: 1px solid #181818; border-radius: 4px; color: #f0f0f0; background: #4772b3; }
.documentation-button--outlined { color: #9fc5ff; background: transparent; border-color: #4772b3; }
.documentation-button--glass { background: rgba(71, 114, 179, 0.24); }
.documentation-button:hover { background: #5683c5; }
.documentation-button:active { background: #365f9d; }
.documentation-button:disabled { color: #808080; background: #333333; }
`.trim()
