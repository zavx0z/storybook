import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Notification from "@zavx0z/immersive-ui-component-feedback-notification"
import {createSettingsClient} from "./client"
import {createBrowserPreviewSession, idleBrowserPreview} from "./browser-preview-session"

type Props = Readonly<{provider: "capsule" | "chrome-studio", connectionId: string, available: boolean, client: ReturnType<typeof createSettingsClient>, sessionFactory?: typeof createBrowserPreviewSession | undefined}>

/** Свёрнутый раздел не подключается; изменённое или отключённое подключение освобождает viewer. */
export function BrowserPreview(props: Props) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <Panel
    label="Браузер"
    expanded={open}
    onToggle={setOpen}
    style={css`
      --panel-content-padding: 0px;
      --panel-content-background: #333333;
      --panel-header-background: #3d3d3d;
      --panel-header-inset: 24px;
      --panel-radius: 0px;
    `}
  >
    {open && props.available ? <BrowserPreviewView
      key={attempt}
      provider={props.provider}
      connectionId={props.connectionId}
      client={props.client}
      sessionFactory={props.sessionFactory}
      onReconnect={() => setAttempt(value => value + 1)}
    /> : null}
    {open && !props.available ? <UnavailableBrowser /> : null}
  </Panel>
}

function UnavailableBrowser() {
  return <p style={css`
    margin: 8px 12px 8px 28px;
    font-size: 13px;
    color: var(--widget-list-content);
  `}>Сохраните и включите подключение, чтобы открыть браузер.</p>
}

function BrowserPreviewView(props: Omit<Props, "available"> & Readonly<{onReconnect(): void}>) {
  const surface = useRef<HTMLElement | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const keyboard = useRef<HTMLTextAreaElement | null>(null)
  const session = useRef<ReturnType<typeof createBrowserPreviewSession> | null>(null)
  const pointers = useRef(new Set<number>())
  const providerName = props.provider === "capsule" ? "Capsule" : "Chrome Studio"
  const [control, setControl] = useState(props.provider === "capsule")
  const [state, setState] = useState(idleBrowserPreview)
  const [dismissedNotification, setDismissedNotification] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState("")
  const mounted = useRef(true)
  const release = () => {
    session.current?.release()
    for (const pointer of pointers.current) {
      try {video.current?.releasePointerCapture(pointer)} catch {}
    }
    pointers.current.clear()
  }
  useEffect(() => {
    const changed = () => {
      setFullscreen(document.fullscreenElement === surface.current)
      release()
    }
    document.addEventListener("fullscreenchange", changed)
    return () => {
      mounted.current = false
      document.removeEventListener("fullscreenchange", changed)
    }
  }, [])
  const toggleFullscreen = async () => {
    setFullscreenError("")
    setDismissedNotification(null)
    release()
    try {
      if (document.fullscreenElement === surface.current) await document.exitFullscreen()
      else await surface.current?.requestFullscreen({navigationUI: "hide"})
    } catch (error) {
      if (mounted.current) setFullscreenError(error instanceof Error ? error.message : String(error))
    }
  }
  useEffect(() => {
    const element = video.current
    if (!element) return
    let alive = true
    const value = (props.sessionFactory ?? createBrowserPreviewSession)({origin: globalThis.location?.origin ?? "http://localhost", video: element,
      open: signal => props.client.openBrowserViewer(props.connectionId, signal),
      onState: value => {if (alive) setState(value)},
      onBoundary: release,
    })
    session.current = value
    value.setControl(control)
    value.mute(true)
    void value.start()
    return () => {
      alive = false
      release()
      value.close()
      if (session.current === value) session.current = null
    }
  }, [props.client, props.connectionId, props.sessionFactory])
  useEffect(() => {session.current?.setControl(control); if (!control) release()}, [control])
  const down = (event: PointerEvent) => {
    if (!session.current?.pointer("pointerDown", event)) return
    try {video.current?.setPointerCapture(event.pointerId); pointers.current.add(event.pointerId)} catch {}
    keyboard.current?.focus({preventScroll: true})
    event.preventDefault()
  }
  const up = (event: PointerEvent) => {
    if (session.current?.pointer("pointerUp", event, pointers.current.has(event.pointerId))) event.preventDefault()
    pointers.current.delete(event.pointerId)
    try {video.current?.releasePointerCapture(event.pointerId)} catch {}
  }
  const labels: Record<string, string> = {idle: "Готов к подключению", connecting: "Подключение…", "waiting-sender": "Ожидаем видео Capsule…",
    negotiating: "Подключаем видео…", connected: "Подключён", disconnected: "Соединение прервано", closed: "Отключён", failed: "Ошибка подключения"}
  const displayStatus = state.status === "connected" && (state.mediaStatus !== "playing" || state.width < 1 || state.height < 1) ? "Ожидаем изображение…" : labels[state.status] ?? state.status
  const status = `${displayStatus}${state.width > 0 ? ` · ${state.width} × ${state.height}` : ""}${control && state.controlStatus === "open" ? " · Управление доступно" : ""}`
  const notification = fullscreenError || state.error || status
  return <section
    ref={element => {surface.current = element}}
    data-browser-preview=""
    aria-label={`Браузер ${providerName}`}
    style={css`
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;

      &:fullscreen {
        background: #202020;
      }

      &:fullscreen [data-browser-video-surface] {
        flex-grow: 1;
        min-height: 0;
      }

      &:fullscreen [data-browser-video] {
        height: 100%;
        aspect-ratio: auto;
      }
    `}
  >
    <div
      data-browser-video-surface=""
      style={css`
        position: relative;
        width: 100%;
      `}
    >
      <video
        data-browser-video=""
        ref={element => {video.current = element}}
        autoplay={true}
        muted={true}
        playsInline={true}
        aria-label={`Видео профиля ${providerName}`}
        tabIndex={0}
        onFocus={() => {
          if (control && state.controlStatus === "open") keyboard.current?.focus({preventScroll: true})
        }}
        onPointerDown={down}
        onPointerUp={up}
        onPointerMove={(event: PointerEvent) => {
          if (session.current?.pointer("pointerMove", event, pointers.current.has(event.pointerId))) event.preventDefault()
        }}
        onPointerCancel={release}
        onLostPointerCapture={(event: PointerEvent) => {
          if (pointers.current.has(event.pointerId)) release()
        }}
        onContextMenu={(event: MouseEvent) => {if (control) event.preventDefault()}}
        onWheel={(event: WheelEvent) => {if (session.current?.wheel(event)) event.preventDefault()}}
        style={css`
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          object-fit: contain;
          background: #202020;
          touch-action: none;
        `}
      />
      <div style={css`
        position: absolute;
        left: 8px;
        bottom: 8px;
        z-index: 1;
        max-width: calc(100% - 16px);

      `}>
        {dismissedNotification !== notification ? <Notification
          heading={fullscreenError ? "Полноэкранный режим" : state.error ? "Ошибка подключения" : `Браузер ${providerName}`}
          message={notification}
          tone={fullscreenError || state.error ? "error" : state.status === "connected" ? "success" : "info"}
          dismissible={true}
          onDismiss={() => setDismissedNotification(notification)}
          style={css`
            max-width: 100%;
          `}
        /> : null}
      </div>
    </div>
    <textarea
      ref={element => {keyboard.current = element}}
      aria-label="Ввод в удалённый браузер"
      tabIndex={-1}
      autocomplete="off"
      spellcheck={false}
      onKeyDown={(event: KeyboardEvent) => {if (session.current?.key("keyDown", event)) event.preventDefault()}}
      onKeyUp={(event: KeyboardEvent) => {if (session.current?.key("keyUp", event)) event.preventDefault()}}
      onBeforeInput={(event: InputEvent) => {
        if (!event.isComposing && (event.inputType === "insertText" || event.inputType === "insertReplacementText") && event.data && session.current?.text(event.data)) event.preventDefault()
      }}
      onCompositionEnd={(event: CompositionEvent) => {
        session.current?.text(event.data)
        if (keyboard.current) keyboard.current.value = ""
      }}
      onPaste={(event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain")
        if (text !== undefined && session.current?.paste(text)) event.preventDefault()
      }}
      onInput={(event: InputEvent) => {if (!event.isComposing && keyboard.current) keyboard.current.value = ""}}
      onBlur={release}
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 1px;
        height: 1px;
        min-width: 0;
        min-height: 0;
        padding: 0;
        border: 0;
        opacity: 0;
        pointer-events: none;
      `}
    />
    <div style={css`
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 12px 8px 28px;
      flex-wrap: wrap;
    `}>
      {props.provider === "capsule" ? <Button
        label="Управление"
        title={control ? "Выключить управление мышью и клавиатурой" : "Включить управление мышью и клавиатурой"}
        disabled={state.controlStatus !== "open"}
        selected={control}
        aria-pressed={control}
        size="small"
        variant="text"
        onClick={() => setControl(value => !value)}
      /> : null}
      <Button
        label="Переподключить"
        size="small"
        variant="text"
        onClick={props.onReconnect}
      />
      <Button
        label={fullscreen ? "Вернуть" : "На весь экран"}
        title={fullscreen ? "Выйти из полноэкранного режима (Esc)" : "На весь экран"}
        disabled={!document.fullscreenEnabled}
        size="small"
        variant="text"
        onClick={() => {void toggleFullscreen()}}
      />
    </div>
  </section>
}
