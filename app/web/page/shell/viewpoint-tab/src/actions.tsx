import {useSyncExternalStore} from "@immersive/component"
import {Button} from "@immersive-ui/component"
import type {StorybookAppWebPageShellViewpointTab} from "../contract"

/** Обычные компоненты управления сохраняют клик и перетаскивание родительского Tab. */
export function ViewPointActions(props: StorybookAppWebPageShellViewpointTab.Input & Readonly<{vertical: boolean}>) {
  const state = useSyncExternalStore(props.controls.subscribe, props.controls.getSnapshot)
  return <div
    role="toolbar"
    aria-label="Управление ViewPoint"
    style={css`
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4px;
      padding: 4px;

      ${props.vertical && css`
        flex-direction: column;
      `}
    `}
  >
    <Button
      label="−"
      aria-label="Отдалить ViewPoint"
      title="Отдалить ViewPoint"
      disabled={!state.ready}
      onClick={() => props.controls.zoom(1.2)}
    />
    <Button
      label="+"
      aria-label="Приблизить ViewPoint"
      title="Приблизить ViewPoint"
      disabled={!state.ready}
      onClick={() => props.controls.zoom(1 / 1.2)}
    />
    <Button
      label={state.frozen ? "Разморозить" : "Заморозить"}
      aria-label={state.frozen ? "Разморозить ViewPoint" : "Заморозить ViewPoint"}
      title={state.frozen ? "Включить жесты камеры" : "Отключить жесты камеры"}
      selected={state.frozen}
      disabled={!state.ready}
      onClick={props.controls.toggleFrozen}
    />
    <Button
      label="Вписать"
      aria-label="Вписать в область просмотра"
      disabled={!state.ready}
      onClick={props.controls.fit}
    />
  </div>
}
