import {useLayoutEffect, useRef, useState} from "@zavx0z/immersive-component"
import {observeElementLayout} from "@zavx0z/immersive-dom"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import SelectField from "@zavx0z/immersive-ui-component-field-select"
import svgIcon from "@zavx0z/immersive-tech-svg-encode"
import type {StorybookChatView as Contract} from "../contract"

export const effortLabels: Readonly<Record<string, string>> = {
  none: "Без рассуждения", minimal: "Минимальное", low: "Низкое", medium: "Среднее",
  high: "Высокое", xhigh: "Очень высокое", max: "Максимальное", ultra: "Ультра",
}

function SettingsNotice(props: Readonly<{text: string}>) {
  return <span role="status">
    {props.text}
  </span>
}

export function ChatSettings(props: Readonly<{
  settings: NonNullable<Contract.Input["settings"]>
  busy: boolean
  configuring: boolean
  progress?: string | undefined
  onConfigure: Contract.Input["onConfigure"]
  execution?: Contract.Input["execution"]
  onExecutionChange?: Contract.Input["onExecutionChange"]
  onClose?: (() => void) | undefined
}>) {
  const root = useRef<HTMLElement | null>(null)
  const [placement, setPlacement] = useState({height: 320, cover: false})
  useLayoutEffect(() => {
    const menu = root.current
    const anchor = menu?.parentElement
    const conversation = menu?.closest<HTMLElement>("[data-chat-view]")
    if (!anchor || !conversation) return
    const measure = () => {
      const bounds = conversation.getBoundingClientRect()
      const above = anchor.getBoundingClientRect().top - bounds.top - 8
      const cover = above < 120
      const height = Math.max(0, Math.min(320, cover ? bounds.height : above))
      setPlacement(previous => previous.height === height && previous.cover === cover ? previous : {height, cover})
    }
    const releases = [observeElementLayout(anchor, measure), observeElementLayout(conversation, measure)]
    measure()
    return () => {for (const release of releases) release()}
  }, [])
  return <section
    ref={element => {root.current = element}}
    onKeyDown={event => {if (event.key === "Escape") {event.preventDefault(); props.onClose?.()}}}
    aria-label="Подтверждение действий"
    data-chat-settings=""
    style={css`
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      position: absolute;
      left: 0;
      right: 0;
      bottom: ${placement.cover ? "0" : "100%"};
      z-index: 10;
      flex-shrink: 0;
      width: 100%;
      max-height: ${placement.height}px;
      overflow-y: auto;
      gap: 8px;
      margin-bottom: ${placement.cover ? 0 : 8}px;
      padding: 12px;
      border: 1px solid var(--widget-regular-outline);
      border-radius: 12px;
      background: rgb(var(--surface-750));
    `}
  >
    <Button
      label="Закрыть настройки"
      aria-label="Закрыть настройки"
      variant="text"
      onClick={() => props.onClose?.()}
    />
    {props.execution ? <ApprovalSettings
      execution={props.execution}
      busy={props.busy || props.onExecutionChange === undefined}
      onChange={props.onExecutionChange}
    /> : <SettingsNotice text="Настройки подтверждений пока недоступны" />}
  </section>
}

function ApprovalSettings(props: Readonly<{
  execution: NonNullable<Contract.Input["execution"]>
  busy: boolean
  onChange: Contract.Input["onExecutionChange"]
}>) {
  const execution = props.execution
  const modes = execution.approvalCapabilities?.modes ?? ["ask"]
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 8px;
    `}
  >
    <SelectField
      label="Подтверждения"
      value={execution.selection.approvalMode ?? ""}
      options={[
        {key: "inherit", value: "", label: "Наследовать"},
        ...modes.map(mode => ({key: mode, value: mode, label: mode === "ask" ? "С подтверждениями" : "В пределах назначения без запросов"})),
      ]}
      disabled={props.busy}
      onChange={value => {
        const next = {...execution.selection}
        if (value === "ask" || value === "scoped-autonomous") next.approvalMode = value
        else delete next.approvalMode
        props.onChange?.(next)
      }}
    />
    <p style={css`
      margin: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      font-size: 12px;
    `}>
      Область назначения сохраняется. Отдельные запросы исполнителя за её пределами подтверждаются вручную.
    </p>
  </div>
}

type ModelSettingsInput = Pick<Parameters<typeof ChatSettings>[0], "settings" | "busy" | "configuring" | "progress" | "onConfigure" | "execution" | "onExecutionChange"> & Readonly<{
  usage: Contract.Input["usage"]
}>

/** Провайдер новой беседы выбирается до native identity; модель и мышление остаются в строке над вводом. */
export function ChatModelSettings(props: ModelSettingsInput) {
  return <section
    data-chat-model-settings=""
    aria-label="Параметры ответа"
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      gap: 6px;
    `}
  >
    {props.execution ? <ProviderSetting input={props} /> : null}
    <div style={css`
      display: flex;
      flex-direction: row;
      align-items: center;
      min-width: 0;
      width: 100%;
      gap: 8px;
    `}>
      <ContextIndicator usage={props.usage} />
      <ResponseSetting field="model" input={props} />
      <ResponseSetting field="thoughtLevel" input={props} />
    </div>
  </section>
}

/** Native identity закрепляет провайдера; новый выбор удаляет зависимые параметры прежнего исполнения. */
function ProviderSetting(props: Readonly<{input: ModelSettingsInput}>) {
  const input = props.input
  const execution = input.execution!
  const pinned = execution.pinnedConnectionId !== undefined
  const current = execution.connections.find(item => item.id === execution.effective.connectionId)
  return <SelectField
    label="Провайдер"
    title={pinned ? "Провайдер закреплён за существующей сессией" : "Провайдер новой беседы"}
    density="compact"
    value={execution.selection.connectionId ?? ""}
    options={[
      {key: "inherit", value: "", label: `Наследовать · ${current?.label ?? execution.effective.connectionId}`},
      ...execution.connections.map(item => ({key: item.id, value: item.id, label: `${item.label}${item.enabled ? "" : " · отключено"}`})),
    ]}
    disabled={input.busy || pinned || input.onExecutionChange === undefined}
    onChange={value => {
      if (pinned) return
      const next = {...execution.selection}
      delete next.model
      delete next.thoughtLevel
      if (value) next.connectionId = value
      else delete next.connectionId
      input.onExecutionChange?.(next)
    }}
  />
}

/** Смена модели удаляет зависимое мышление; остальные overrides беседы сохраняются. */
function ResponseSetting(props: Readonly<{field: "model" | "thoughtLevel", input: ModelSettingsInput}>) {
  const input = props.input
  const category = props.field === "model" ? "model" : "thought_level"
  const setting = input.settings.find(option => option.category === category)
  const selected = input.execution?.selection[props.field]
  const effective = input.execution?.effective[props.field] ?? setting?.value
  const name = (value: string) => props.field === "thoughtLevel" ? effortLabels[value] ?? setting?.options.find(item => item.value === value)?.name ?? value
    : setting?.options.find(item => item.value === value)?.name ?? value
  const options = setting?.options.map(item => ({key: item.value, value: item.value, label: name(item.value), description: item.description})) ?? []
  if (selected && !options.some(option => option.value === selected)) options.push({key: selected, value: selected, label: name(selected), description: "Сохранённый выбор"})
  const inherit = input.execution !== undefined
  const value = inherit ? selected ?? "" : setting?.value ?? ""
  const placeholder = input.configuring ? "Загрузка…" : "Нет данных"
  const description = input.configuring ? input.progress ?? "Загрузка параметров исполнителя" : "Параметр пока недоступен"
  const choices = setting === undefined ? [{key: "unavailable", value, label: placeholder, description, disabled: true}]
    : inherit ? [{key: "inherit", value: "", label: input.configuring && selected === undefined ? "Применяется…" : effective === undefined ? "По умолчанию" : name(effective),
    description: input.configuring && selected === undefined ? "Ожидание подтверждённых параметров исполнителя" : `Наследовать ${props.field === "model" ? "модель" : "усилие рассуждения"}${effective === undefined ? "" : `: ${name(effective)}`}`}, ...options]
    : options.length ? options : [{key: "unavailable", value: "", label: "Нет данных", disabled: true}]
  return <div
    data-chat-response-setting={props.field}
    style={css`
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-width: 0;
      gap: 3px;
    `}
  >
    <SelectField
      title={props.field === "model" ? "Модель ответа" : "Усилие рассуждения"}
      density="compact"
      value={value}
      options={choices}
      disabled={input.busy || setting === undefined || (inherit ? input.onExecutionChange === undefined : input.onConfigure === undefined)}
      onChange={value => {
        if (inherit) {
          const next = {...input.execution!.selection}
          if (props.field === "model") delete next.thoughtLevel
          if (value) next[props.field] = value
          else delete next[props.field]
          input.onExecutionChange?.(next)
        } else if (setting) input.onConfigure?.(setting.id, value)
      }}
      style={css`
        width: 100%;
        min-width: 0;
      `}
    />
  </div>
}

/** Кольцо показывает фактическое заполнение; used/size и процент доступны в подсказке. */
export function ContextIndicator(props: Readonly<{usage: Contract.Input["usage"]}>) {
  const usage = props.usage
  const percentage = usage ? Math.round(usage.used / usage.size * 100) : null
  const amount = (value: number) => value >= 1000 ? `${new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 1}).format(value / 1000)} к` : String(value)
  const label = usage
    ? `Контекстное окно: ${percentage}% заполнено\nИспользовано ${amount(usage.used)} / ${amount(usage.size)} токенов`
    : "Контекстное окно: данные ещё не получены от агента"
  const length = 2 * Math.PI * 7
  const filled = length * Math.max(0, Math.min(100, percentage ?? 0)) / 100
  const icon = svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="#555" stroke-width="2.5"/><circle cx="10" cy="10" r="7" fill="none" stroke="#ccc" stroke-width="2.5" stroke-dasharray="${filled} ${length}" transform="rotate(-90 10 10)"/></svg>`)
  return <span
    data-chat-context=""
    title={label}
    aria-label={label}
    role="img"
    tabIndex={0}
    style={css`
      display: flex;
      align-items: center;
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      min-width: 20px;
    `}
  >
    <img
      src={icon}
      width={20}
      height={20}
      alt=""
      style={css`
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      `}
    />
  </span>
}
