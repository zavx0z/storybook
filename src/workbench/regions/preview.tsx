import {WorkbenchRegionHeading} from "../components/region-heading.tsx"
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"
import type {WorkbenchPresentationProjection} from "../contract.ts"

export type PreviewRegionProps = Readonly<{
  label: string
  projection: WorkbenchPresentationProjection
}>

function PreviewRegionContent(props: Readonly<{value: PreviewRegionProps}>) {
  const value = props.value
  return <div style={css`
    & {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      flex-grow: 1;
      gap: 2px;
    }
  `}>
    <WorkbenchRegionHeading text={value.label} />
    <section
      role="region"
      aria-label={value.label}
      aria-live="polite"
      data-storybook-part="preview-host"
      data-active-projection={value.projection}
      style={css`
        & {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex-grow: 1;
          align-items: center;
          justify-content: center;
        }
      `}
    >
      <div
        data-storybook-projection="display"
        hidden={value.projection !== "display"}
        style={css`
          & {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
          }
          &[hidden] { display: none; }
        `}
      ></div>
      <div
        data-storybook-projection="world"
        aria-label="World semantic anchor"
        hidden={value.projection !== "world"}
        style={css`
          & {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
            background: transparent;
          }
          &[hidden] { display: none; }
        `}
      ></div>
      <div
        data-storybook-projection="hud"
        aria-label="HUD projection"
        hidden={value.projection !== "hud"}
        style={css`
          & {
            position: absolute;
            left: 0;
            top: 0;
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
          }
          &[hidden] { display: none; }
        `}
      ></div>
    </section>
  </div>
}

/** Fixed same-Document display, world and HUD projection hosts. */
export function PreviewRegion(props: PreviewRegionProps) {
  return <main
    data-storybook-region="preview"
    aria-label={props.label}
    style={css`
      & {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex-grow: 1;
      }
    `}
  >
    <WorkbenchRegionPanel transparent={props.projection === "world"}>
      <PreviewRegionContent value={props} />
    </WorkbenchRegionPanel>
  </main>
}
