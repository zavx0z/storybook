import type {HTMLElement} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/react"
import {
  defineSelfStory,
  serializeSelfElement,
} from "./story-types.ts"

type SelfButtonProps = Readonly<{
  variant: "primary" | "outlined"
  disabled: boolean
}>

function SelfButton(props: SelfButtonProps) {
  const label = props.disabled ? "Disabled" : props.variant === "outlined" ? "Outlined" : "Primary"
  return <button
    type="button"
    data-variant={props.variant}
    disabled={props.disabled}
    title="External Storybook live story"
    style={css`
      & {
        display: block;
        width: 220px;
        height: 34px;
        padding: 6px 12px;
        border: 1px solid #31566a;
        border-radius: 3px;
        background: #3d7088;
        color: #f4fbff;
      }
      &:disabled {
        border-color: #333333;
        background: #292929;
        color: #777777;
      }
      &[data-variant="outlined"] {
        background: transparent;
        color: #8fd4f5;
      }
    `}
  >
    {label}
  </button>
}

function button(variant: SelfButtonProps["variant"], disabled: boolean) {
  return defineSelfStory((document) => {
    const staging = document.createElement("div")
    const root = createRoot(staging)
    root.render(<SelfButton variant={variant} disabled={disabled} />)
    const element = staging.querySelector("button") as HTMLElement | null
    if (element === null) {
      root.unmount()
      throw new Error("Self Storybook Button mounted no button")
    }
    staging.removeChild(element)
    return Object.freeze({
      element,
      root,
      source: Object.freeze({
        html: serializeSelfElement(element),
        typescript: `<SelfButton variant=${JSON.stringify(variant)} disabled={${String(disabled)}} />`,
      }),
      props: Object.freeze({variant, disabled}),
      dispose: () => root.unmount(),
    })
  })
}

export const primary = button("primary", false)
export const outlined = button("outlined", false)
export const disabled = button("primary", true)
