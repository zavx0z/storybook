import {useSyncExternalStore} from "@zavx0z/immersive/XReact"
import {Notification} from "@zavx0z/immersive/ui"
import type {createStatusNotifications} from "./status-notifications"

/** Статусы Display используют готовые уведомления в нижнем левом углу общего HUD. */
export function StatusNotifications(props: Readonly<{source: ReturnType<typeof createStatusNotifications>}>) {
  const entries = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return <div
    data-storybook-status-notifications=""
    style={css`
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      max-width: calc(100% - 24px);
      max-height: calc(100% - 24px);
      overflow: auto;
    `}
  >
    {entries.map(entry => <Notification
      key={entry.id}
      heading={entry.heading}
      message={entry.message}
      dismissible={true}
      onDismiss={() => props.source.dismiss(entry.id)}
      style={css`
        max-width: 100%;
        flex-shrink: 0;
      `}
    />)}
  </div>
}
