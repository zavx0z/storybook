import {Button} from "@zavx0z/ui/buttons/button"
import type {HTMLElement} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/component"
import {
  defineSelfStory,
  serializeSelfElement,
} from "./story-types.ts"

type PresentationCanaryProps = Readonly<{
  variant: "primary" | "outlined"
  disabled: boolean
}>

function PresentationCanary(props: PresentationCanaryProps) {
  const label = props.disabled ? "Disabled" : props.variant === "outlined" ? "Outlined" : "Primary"
  return <Button
    label={label}
    variant={props.variant === "outlined" ? "outlined" : "contained"}
    tone="primary"
    disabled={props.disabled}
    title="External Storybook live story"
  />
}

function presentation(variant: PresentationCanaryProps["variant"], disabled: boolean) {
  return defineSelfStory((document) => {
    const staging = document.createElement("div")
    const root = createRoot(staging)
    root.render(<PresentationCanary variant={variant} disabled={disabled} />)
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
        typescript: `<Button label=${JSON.stringify(disabled ? "Disabled" : variant === "outlined" ? "Outlined" : "Primary")} variant=${JSON.stringify(variant === "outlined" ? "outlined" : "contained")} tone="primary" disabled={${String(disabled)}} title="External Storybook live story" />`,
      }),
      props: Object.freeze({variant, disabled}),
      dispose: () => root.unmount(),
    })
  })
}

export const primary = presentation("primary", false)
export const outlined = presentation("outlined", false)
export const disabled = presentation("primary", true)
