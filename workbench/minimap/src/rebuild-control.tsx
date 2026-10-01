import Button from "@zavx0z/ui/button/button"

/**
Показывает действие пересборки Web и его текущий исход в содержимом окна Minimap.
Собственный JSX-компонент пересекает границу slot Window; операция и состояние
остаются у Minimap. Скрытие сохраняет control, а busy блокирует новую попытку.
*/
export default function WebRebuildControl(props: Readonly<{
  visible: boolean
  busy: boolean
  error: string
  onClick: () => void
}>) {
  return <div
    data-storybook-web-rebuild=""
    hidden={!props.visible}
    aria-busy={String(props.busy)}
    style={css`
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      gap: 4px;
      margin-bottom: 6px;

      &[hidden] {
        display: none;
      }
    `}
  >
    <Button
      label={props.busy ? "Пересборка интерфейса…" : "Пересобрать интерфейс"}
      aria-label="Пересобрать интерфейс"
      disabled={props.busy}
      onClick={props.onClick}
    />
    <p
      hidden={props.error === ""}
      role="alert"
      style={css`
        margin: 0;
        white-space: normal;
        color: var(--state-error);

        &[hidden] {
          display: none;
        }
      `}
    >{props.error}</p>
  </div>
}
