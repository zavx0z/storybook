/** Начальные метрики заменяются геометрией области HUD после её первой раскладки. */
export function StorybookDisplay(props: Readonly<{id: string}>) {
  return (
    <display
      id={props.id}
      width={960 * 25.4 / 96}
      height={540 * 25.4 / 96}
      style={css`
        box-sizing: border-box;
        width: var(--preview-resolution-width, 960px);
        height: var(--preview-resolution-height, 540px);
        translate: 0 0 0;
        rotate: x 90deg;
        scale: 1;
        visibility: var(--preview-visibility, visible);

        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--widget-box-outline);
        border-radius: 4px;
        overflow: hidden;
        align-items: center;
        justify-content: center;
      `}
    />
  )
}
