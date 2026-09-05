import {Display} from "@zavx0z/space/display"

/** The Display itself owns its border, layout and overflow clipping. */
export function StorybookDisplay(props: Readonly<{id: string}>) {
  return <Display
    id={props.id}
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
