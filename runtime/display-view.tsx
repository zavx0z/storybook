/** Дисплей владеет своей рамкой, раскладкой и обрезкой содержимого. */
export function StorybookDisplay(props: Readonly<{id: string}>) {
  return (
    <display
      id={props.id}
      dpi={96}
      style={css`
        box-sizing: border-box;
        width: var(--preview-width, 960px);
        height: var(--preview-height, 540px);
        translate: var(--preview-x, 0mm) 0 var(--preview-z, 0mm);
        rotate: x 90deg;
        scale: var(--preview-scale, 1);
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
