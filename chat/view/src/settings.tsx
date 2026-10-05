import SelectField from "@zavx0z/immersive-ui-component-field-select"
import svgIcon from "@zavx0z/immersive-tech-svg-encode"
import type {StorybookChatView as Contract} from "../contract"
import Preferences from "@zavx0z/storybook-chat-preferences"

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
}>) {
  return <section
    aria-label="Настройки модели"
    data-chat-settings=""
    style={css`
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      position: absolute;
      left: 0;
      right: 0;
      bottom: 100%;
      z-index: 10;
      flex-shrink: 0;
      width: 100%;
      gap: 8px;
      margin-bottom: 8px;
      padding: 12px;
      border: 1px solid var(--widget-regular-outline);
      border-radius: 12px;
      background: rgb(var(--surface-750));
    `}
  >
    {props.configuring ? <SettingsNotice text={props.progress ?? "Загрузка настроек…"} /> : null}
    {!props.configuring && props.settings.length === 0 ? <SettingsNotice text="Настройки пока недоступны" /> : null}
    {props.execution ? <Preferences
      selection={props.execution.selection}
      effective={props.execution.effective}
      sources={props.execution.sources}
      connections={props.execution.connections}
      settings={props.settings}
      busy={props.busy || props.onExecutionChange === undefined}
      onChange={value => props.onExecutionChange?.(value)}
    /> : <NativeSettings settings={props.settings} busy={props.busy} onConfigure={props.onConfigure} />}
  </section>
}

function NativeSettings(props: Pick<Parameters<typeof ChatSettings>[0], "settings" | "busy" | "onConfigure">) {
  return <div>
    {props.settings.map(option => <SelectField
      key={option.id}
      label={option.category === "model" ? "Модель" : "Мышление"}
      title={option.category === "model" ? "Модель" : "Уровень мышления"}
      value={option.value}
      options={option.options.map(item => ({
        key: item.value,
        value: item.value,
        label: option.category === "thought_level" ? effortLabels[item.value] ?? item.name : item.name,
        description: item.description,
      }))}
      disabled={props.busy || props.onConfigure === undefined}
      onChange={value => props.onConfigure?.(option.id, value)}
    />)}
  </div>
}

/** Кольцо показывает только полученные от агента used/size; отсутствие данных не равно нулю. */
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
      justify-content: center;
      flex-shrink: 0;
      width: 24px;
      height: 28px;
    `}
  >
    <img
      src={icon}
      width={20}
      height={20}
      alt=""
    />
  </span>
}
