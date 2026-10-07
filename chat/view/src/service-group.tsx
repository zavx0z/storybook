import ToolTerminal from "./terminal-output-view"
import {readTerminalOutput} from "./terminal-output"
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "@zavx0z/immersive-component"
import HistoryView from "@zavx0z/chat/history/view"
import type { HistoryGroup } from "@zavx0z/storybook-chat-session"
import type { StorybookChatView } from "../contract"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import type { DisplayBody } from "../contract/history"
import type { HistoryOccurrence } from "@zavx0z/storybook-chat-session"
import { ChatContent, ChatContextContent, ChatData } from "./content"

/** Раскрытие владеет mount; прокрутка родителя и revision сохраняют controller и anchor.
Конструктор в useMemo не публикует состояние; чтение начинается из commit effect.
Disposal отзывает всё вложенное окно и освобождает долю общего бюджета host. */
export default function ServiceGroup(
  props: Readonly<{ group: HistoryGroup; view: StorybookChatView.Input }>
) {
  const heights = useRef<ReadonlyMap<string, number>>(new Map())
  const controller = useMemo(
    () => props.view.createGroupHistory?.(props.group),
    [props.view.createGroupHistory, props.view.history.chatId, props.group.id]
  )
  useLayoutEffect(() => () => controller?.dispose(), [controller])
  useLayoutEffect(() => {
    controller?.accept({
      id: props.view.history.chatId ?? "",
      history: { revision: props.group.revision, total: props.group.memberCount }
    })
  }, [controller, props.group.revision, props.group.memberCount])
  const source = useMemo(() => ({
    subscribe: (listener: () => void) => controller?.subscribe?.(listener) ?? (() => {}),
    getSnapshot: () => controller?.getSnapshot()
  }), [controller])
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const { conversationId, rows, ...state } = snapshot ?? {
    conversationId: props.view.history.chatId,
    rows: [],
    revision: 0,
    total: 0,
    before: null,
    after: null,
    unread: 0,
    following: false,
    loading: false
  }
  const history = {
    ...state,
    chatId: conversationId,
    rows: rows.map(({ evidence, ...row }) => row)
  }
  const view: StorybookChatView.Input = {
    ...props.view,
    history,
    onHistoryViewport: (value) => controller?.viewport(value),
    onHistoryVisible: (value) => controller?.setActive(value),
    onHistoryExpand: (id, value) => controller?.expand(id, value),
    onHistoryRetry: (id) => controller?.retry(id),
    onHistoryEvidence: (id, after) => {
      void controller?.evidence(id, after)
    },
    onHistoryTail: () => controller?.tail(),
    onHistoryRetryPage: () => controller?.retryPage()
  }
  return (
    <section
      data-chat-service-group={props.group.id}
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        min-height: 0;
        height: auto;
        max-height: 320px;
      `}
    >
      {!controller ? <FragmentError error="Подробности группы недоступны" /> : null}
      <HistoryView
        identity={props.group.id}
        history={history}
        onViewport={view.onHistoryViewport}
        onVisible={view.onHistoryVisible}
        onTail={view.onHistoryTail}
        onRetry={view.onHistoryRetryPage}
        onRowHeights={(value) => {
          heights.current = new Map(value)
        }}
      >
        <ServiceRows rows={history.rows} view={view} heights={heights.current} />
      </HistoryView>
    </section>
  )
}

function ServiceOccurrence(
  props: Readonly<{
    row: {
      header: HistoryOccurrence
      body?: DisplayBody | undefined
      expanded: boolean
      loading: boolean
      error?: string | undefined
    }
    view: StorybookChatView.Input
    height: number
  }>
) {
  const { row, view } = props
  const header = row.header
  const states: Record<string, string> = {
    started: "Выполняется",
    in_progress: "Выполняется",
    completed: "Готово",
    failed: "Ошибка",
    cancelled: "Остановлено",
    requested: "Ожидает решения",
    decided: "Решение сохранено",
    interrupted: "Прервано"
  }
  const events: Record<string, string> = {
    usage_update: "Контекстное окно",
    config_option_update: "Настройки исполнителя",
    current_mode_update: "Режим работы",
    available_commands_update: "Доступные команды",
    session_info_update: "Сведения о беседе"
  }
  const title =
    header.title ??
    (header.kind === "context"
      ? "Переданный контекст"
      : header.kind === "message"
        ? header.purpose === "command"
          ? "Команда среды"
          : "Рассуждение"
        : header.kind === "turn"
          ? "Выполнение"
          : (events[header.eventType ?? ""] ?? "Событие"))
  const status = header.status ?? header.state ?? header.phase
  const label = `${title}${status ? ` · ${states[status] ?? status}` : ""}`
  const minimumHeight = row.expanded && !row.body ? props.height : 0
  return (
    <div
      data-chat-history-id={header.id}
      data-chat-ordinal={header.ordinal}
      style={css`
        width: 100%;
        min-width: 0;
        min-height: ${minimumHeight}px;
        flex-shrink: 0;
      `}
    >
      <Panel
        label={label}
        expanded={row.expanded}
        onToggle={(value) => view.onHistoryExpand(header.id, value)}
      >
        {row.expanded && row.body ? (
          <ServiceBody body={row.body} header={header} view={view} />
        ) : null}
        {row.expanded && !row.body ? (
          <PendingService row={row} onRetry={() => view.onHistoryRetry(header.id)} />
        ) : null}
      </Panel>
    </div>
  )
}

function ServiceBody(
  props: Readonly<{ body: DisplayBody; header: HistoryOccurrence; view: StorybookChatView.Input }>
) {
  const { body, header, view } = props
  return (
    <div data-chat-service-body={header.id}>
      {body.kind === "tool" ? <ServiceToolBody body={body} view={view} /> : null}
      {body.kind === "context" || body.kind === "message" ? (
        <ServiceContextBody body={body} header={header} view={view} />
      ) : null}
      {body.kind === "permission" || body.kind === "event" || body.kind === "turn" ? (
        <ChatData label="Подробности" value={body} />
      ) : null}
      {body.kind === "detail" ? <DetailFragments body={body} view={view} /> : null}
    </div>
  )
}
function ServiceToolContent(
  props: Readonly<{
    content: NonNullable<Extract<DisplayBody, { kind: "tool" }>["call"]["content"]>[number]
    view: StorybookChatView.Input
  }>
) {
  const { content, view } = props
  return (
    <div>
      {content.type === "content" ? (
        <ChatContent content={content.content} onMedia={view.onMedia} />
      ) : (
        <ChatData
          label={content.type === "terminal" ? "Терминал" : "Изменение файла"}
          value={content}
        />
      )}
    </div>
  )
}

/** Продолжение заменяет предыдущую порцию: DOM никогда не собирает весь большой ответ. */
export function ContentFragments(
  props: Readonly<{
    id: string
    body: Extract<DisplayBody, { kind: "message" | "context" }>
    view: StorybookChatView.Input
  }>
) {
  type Page = Awaited<ReturnType<NonNullable<StorybookChatView.Input["readHistoryContent"]>>>
  const [page, setPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    request.current?.abort()
    setPage(null)
    setLoading(false)
    setError("")
    return () => request.current?.abort()
  }, [props.id, props.body.historyRevision])
  const next = page?.next ?? (page === null ? props.body.continuation : null)
  const load = async () => {
    if (!next || !props.view.readHistoryContent || loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")
    try {
      const value = await props.view.readHistoryContent(props.id, next, controller.signal)
      if (controller.signal.aborted || request.current !== controller) return
      if (
        value.id !== props.id ||
        value.chatId !== props.view.history.chatId ||
        (props.body.historyRevision !== undefined && value.revision !== props.body.historyRevision)
      )
        throw new Error("Запись обновилась; откройте её снова")
      setPage(value)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return (
    <section data-chat-content-fragments="">
      <p>Большое сообщение · продолжение по частям</p>
      {page ? <ContentPage page={page} view={props.view} /> : null}
      {error ? <FragmentError error={error} /> : null}
      {next ? (
        <Button
          label={loading ? "Загрузка…" : error ? "Повторить загрузку" : "Следующая часть"}
          disabled={loading || !props.view.readHistoryContent}
          onClick={() => {
            void load()
          }}
        />
      ) : null}
      {page ? (
        <Button
          label="К началу продолжения"
          onClick={() => {
            request.current?.abort()
            setPage(null)
            setLoading(false)
            setError("")
          }}
        />
      ) : null}
    </section>
  )
}

/** Readonly JSON fragment — отдельная frontend проекция, не поддельный ACP event. */
export function DetailFragments(
  props: Readonly<{ body: Extract<DisplayBody, { kind: "detail" }>; view: StorybookChatView.Input }>
) {
  const [page, setPage] = useState(props.body.detail)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    request.current?.abort()
    setPage(props.body.detail)
    setLoading(false)
    setError("")
    return () => request.current?.abort()
  }, [props.body.id, props.body.detail.revision])
  const load = async () => {
    if (page.next === null || !props.view.readHistoryDetail || loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")
    try {
      const value = await props.view.readHistoryDetail(
        props.body.sourceId ?? props.body.id,
        page.next,
        controller.signal,
        props.body.evidenceId
      )
      if (controller.signal.aborted || request.current !== controller) return
      if (
        value.id !== (props.body.sourceId ?? props.body.id) ||
        value.chatId !== props.view.history.chatId ||
        value.revision !== props.body.detail.revision
      )
        throw new Error("Результат обновился; откройте его снова")
      setPage(value)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return (
    <section data-chat-detail-fragments="">
      <ChatData label="Часть большого результата" value={page.text} languageId="json" />
      {error ? <FragmentError error={error} /> : null}
      {page.next !== null ? (
        <Button
          label={loading ? "Загрузка…" : error ? "Повторить загрузку" : "Следующая часть"}
          disabled={loading || !props.view.readHistoryDetail}
          onClick={() => {
            void load()
          }}
        />
      ) : null}
      {page !== props.body.detail ? (
        <Button
          label="К началу результата"
          onClick={() => {
            request.current?.abort()
            setPage(props.body.detail)
            setLoading(false)
            setError("")
          }}
        />
      ) : null}
    </section>
  )
}

function ServiceRows(
  props: Readonly<{
    rows: readonly Parameters<typeof ServiceOccurrence>[0]["row"][]
    view: StorybookChatView.Input
    heights: ReadonlyMap<string, number>
  }>
) {
  return (
    <div
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        gap: 8px;
      `}
    >
      {props.rows.map((row) => (
        <ServiceOccurrence
          key={row.header.id}
          row={row}
          view={props.view}
          height={props.heights.get(row.header.id) ?? 32}
        />
      ))}
    </div>
  )
}
function PendingService(
  props: Readonly<{ row: Parameters<typeof ServiceOccurrence>[0]["row"]; onRetry(): void }>
) {
  const statusText = props.row.loading ? "Загрузка…" : props.row.error ?? "Содержимое выгружено"
  return (
    <div>
      <p>{statusText}</p>
      {!props.row.loading ? <Button label="Повторить загрузку" onClick={props.onRetry} /> : null}
    </div>
  )
}
function ServiceToolBody(
  props: Readonly<{ body: Extract<DisplayBody, { kind: "tool" }>; view: StorybookChatView.Input }>
) {
  const terminal = readTerminalOutput(props.body.call)
  return (
    <div>
      {(props.body.call.content ?? []).filter(content => content.type !== "terminal").map((content, index) => (
        <ServiceToolContent key={index} content={content} view={props.view} />
      ))}
      {props.body.call.rawInput !== undefined ? (
        <ChatData label="Аргументы" value={props.body.call.rawInput} />
      ) : null}
      {terminal.known || props.body.terminal ? <ToolTerminal
        id={props.body.terminal?.id ?? props.body.id}
        call={props.body.call}
        terminal={props.body.terminal}
        read={props.view.readHistoryTerminal}
      /> : null}
      {props.body.call.rawOutput !== undefined && !terminal.known && !props.body.terminal ? (
        <ChatData label="Результат" value={props.body.call.rawOutput} />
      ) : null}
    </div>
  )
}
function ServiceContextBody(
  props: Readonly<{
    body: Extract<DisplayBody, { kind: "message" | "context" }>
    header: HistoryOccurrence
    view: StorybookChatView.Input
  }>
) {
  return (
    <div>
      {props.body.content.map((content, index) => (
        <ChatContextContent key={index} content={content} onMedia={props.view.onMedia} />
      ))}
      {props.body.continuation ? (
        <ContentFragments id={props.header.entryId} body={props.body} view={props.view} />
      ) : null}
    </div>
  )
}
function ContentPage(
  props: Readonly<{
    page: Awaited<ReturnType<NonNullable<StorybookChatView.Input["readHistoryContent"]>>>
    view: StorybookChatView.Input
  }>
) {
  return (
    <div>
      {props.page.content.map((content, index) => (
        <ChatContent key={index} content={content} onMedia={props.view.onMedia} />
      ))}
    </div>
  )
}
function FragmentError(props: Readonly<{ error: string }>) {
  return <p role="alert">{props.error}</p>
}
