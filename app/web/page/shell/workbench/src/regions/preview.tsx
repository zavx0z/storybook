import type {WorkbenchPresentationProjection} from "../types.ts"
import {Pane} from "@zavx0z/immersive/ui"

export type PreviewRegionProps = Readonly<{
  label: string
  projection: WorkbenchPresentationProjection
}>

/** Проекции сохраняют semantic узлы внутри одного Document. */
function PreviewRegionContent(props: Readonly<{value: PreviewRegionProps}>) {
  const value = props.value
  return <section
    role="region"
    aria-label={value.label}
    aria-live="polite"
    data-storybook-part="preview-host"
    data-active-projection={value.projection}
    style={css`
      position: relative;
      box-sizing: border-box;
      background: transparent;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex-grow: 1;
      align-items: center;
      justify-content: center;

    `}
  >
    <div
      data-storybook-projection="display"
      hidden={value.projection !== "display"}
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        align-items: center;
        justify-content: center;

        &[hidden] {
          display: none;
        }
      `}
    ></div>
    <div
      data-storybook-projection="space"
      aria-label="Space semantic anchor"
      hidden={value.projection !== "space"}
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        background: transparent;

        &[hidden] {
          display: none;
        }
      `}
    ></div>
    <div
      data-storybook-projection="hud"
      aria-label="HUD projection"
      hidden={value.projection !== "hud"}
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;

        &[hidden] {
          display: none;
        }
      `}
    ></div>
  </section>
}

/** Pane владеет рамкой Preview; содержимое сохраняет узлы проекций Display, HUD и Space. */
export function PreviewRegion(props: PreviewRegionProps) {
  return <main
    data-storybook-region="preview"
    aria-label={props.label}
    style={css`
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-grow: 1;
    `}
  >
    <Pane
      variant="outlined"
      style={css`
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 0;
        flex-grow: 1;
        gap: 2px;
        padding: 0;
      `}
    >
      <PreviewRegionContent value={props} />
    </Pane>
  </main>
}
