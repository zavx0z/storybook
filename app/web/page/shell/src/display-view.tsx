import type {DisplayElement} from "@zavx0z/immersive"
import type {JSX} from "@zavx0z/immersive/XReact"

/** Одна оболочка Workbench; положение и физический габарит не меняют её оформление. */
export function StorybookDisplay(props: Readonly<{
  id: string
  surface?: Readonly<{x: number; y: number; z: number; width: number; height: number}>
  viewport?: Readonly<{width: number; height: number}>
  onReady?: (display: DisplayElement | null) => void
  children?: JSX.Element | null
}>) {
  return (
    <display
      id={props.id}
      ref={props.onReady}
      width={props.surface?.width ?? 960 * 25.4 / 96}
      height={props.surface?.height ?? 540 * 25.4 / 96}
      style={css`
        box-sizing: border-box;
        background: transparent;
        --workbench-resolution-width: ${props.viewport?.width ?? 960}px;
        --workbench-resolution-height: ${props.viewport?.height ?? 540}px;
        width: var(--workbench-resolution-width, 960px);
        height: var(--workbench-resolution-height, 540px);
        translate: ${props.surface?.x ?? 0}mm ${props.surface?.y ?? 0}mm ${props.surface?.z ?? 0}mm;
        rotate: x 90deg;
        scale: 1;

        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        align-items: center;
        justify-content: center;
      `}
    >
      {props.children}
    </display>
  )
}
