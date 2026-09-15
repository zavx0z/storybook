/** Положение общей сцены, вычисленное host по фактическим границам компонента. */
export type ScenarioPreviewPlacement = Readonly<{x: number; y: number}>

/**
Предоставляет место общей фикстуре в существующем Display.
Host подключает компонент к stage один раз и обновляет его props отдельно.
*/
export function ScenarioPreview(props: Readonly<{
  placement: ScenarioPreviewPlacement
}>) {
  return <section
    data-scenario-preview=""
    style={css`
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    `}
  >
    <div
      data-scenario-stage=""
      style={css`
        position: relative;
        width: 100%;
        height: 100%;

        --scenario-x: ${props.placement.x}px;
        --scenario-y: ${props.placement.y}px;

        transform: translate(var(--scenario-x), var(--scenario-y));
      `}
    ></div>
  </section>
}
