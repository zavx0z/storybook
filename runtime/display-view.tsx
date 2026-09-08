/** Дисплей владеет своей рамкой, раскладкой и обрезкой содержимого. */
export function StorybookDisplay(props: Readonly<{id: string}>) {
  return (
    <display
      id={props.id}
      dpi={96}
      style={css`
        box-sizing: border-box;
        width: 600mm;
        height: 337.5mm;
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
