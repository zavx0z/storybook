import type {JSX} from "@jsx-compiler/session"

/** Поверхность всего Workbench; shell синхронизирует её метрики с viewport общего Root. */
export function StorybookDisplay(props: Readonly<{id: string; children?: JSX.Element | readonly JSX.Element[]}>) {
  return (
    <display
      id={props.id}
      width={960 * 25.4 / 96}
      height={540 * 25.4 / 96}
      style={css`
        box-sizing: border-box;
        width: var(--workbench-resolution-width, 960px);
        height: var(--workbench-resolution-height, 540px);
        translate: 0 0 0;
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
