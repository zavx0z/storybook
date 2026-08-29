import type {Document, HTMLButtonElement} from "@zavx0z/dom"

function button(variant: "primary" | "outlined", disabled: boolean) {
  return Object.freeze({
    render(document: Document): HTMLButtonElement {
      const element = document.createElement("button")
      element.className = `external-self-button external-self-button--${variant}`
      element.type = "button"
      element.disabled = disabled
      element.title = "External Storybook live story"
      element.textContent = disabled ? "Disabled" : variant === "outlined" ? "Outlined" : "Primary"
      return element
    },
    source: Object.freeze({
      html: `<button${disabled ? " disabled" : ""}>${variant}</button>`,
      css: `.external-self-button--${variant} {}`,
      typescript: `button.disabled = ${String(disabled)}`,
    }),
    props: Object.freeze({variant, disabled}),
  })
}

export const primary = button("primary", false)
export const outlined = button("outlined", false)
export const disabled = button("primary", true)
