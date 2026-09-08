import {Display} from "@zavx0z/space/portals/display"

/** The Display itself owns its border, layout and overflow clipping. */
export function StorybookDisplay(props: Readonly<{id: string}>) {
  return <Display
    id={props.id}
    rotation={{x: 90, y: 0, z: 0}}
    size={{width: 960, height: 680}}
    resolution={{width: 960, height: 680}}
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--widget-box-outline);
      border-radius: 4px;
      overflow: hidden;
      align-items: center;
      justify-content: center;
    `}
  />
}
