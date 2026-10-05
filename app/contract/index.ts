import type {StorybookAppControl} from "@zavx0z/storybook-app-control"

/** Контракт единого приложения Storybook. */
export declare namespace StorybookApp {
  /**
  Параметры лаунчера; все необязательны для стандартного запуска.
  @property [daemonEntryPath] - Точная точка входа принадлежащего daemon; используется также изолированными проверками.
  @property [toolRoot] - Канонический checkout приложения с готовыми зависимостями.
  @property [legacyStatePaths] - Пути прежних записей для штатного принятия экземпляра.
  @property [spawnDaemon] - Создаёт принадлежащий процесс по заданию entry/tool/declarations/startLease.
  Возвращает Bun subprocess; завершение и проверка ownership принадлежат лаунчеру.
  */
  type Input = Readonly<{
    daemonEntryPath?: string
    toolRoot?: string
    legacyStatePaths?: readonly string[]
    spawnDaemon?: (input: Readonly<{
      entryPath: string
      toolRoot: string
      declarations: readonly string[]
      preferredPort?: number
      startLease: Readonly<{path: string; token: string}>
    }>) => Bun.Subprocess<"ignore", "ignore", "pipe">
  }>

  /**
  Единый интерфейс управления; каждый вызов получает AbortSignal своего ожидания.
  @property ensure - Запускает или повторно использует сервер и подключает переданные корни.
  @property status - Читает состояние без запуска сервера.
  @property attach - Подключает область к каталогу.
  @property detach - Удаляет область из каталога с сохранением файлов владельца.
  @property search - Читает страницу поиска канонического графа.
  @property open - Открывает кандидата в подходящем представлении, сохраняя другие пакеты.
  @property wait - Ожидает состояние пакета или представления до отмены либо предела ожидания.
  @property inspect - Читает состояние и диагностику точного представления.
  @property interact - Выполняет семантическое действие в точном представлении.
  @property capture - Получает снимок выбранной области и данные результата.
  @property check - Проверяет, собирает и автоматически применяет успешный результат.
  @property close - Закрывает одно указанное представление.
  @property stop - Останавливает принадлежащий сервер при явном подтверждении.
  @property readResource - Читает текстовый либо бинарный ресурс по URI.
  */
  type Output = Awaited<ReturnType<StorybookAppControl.Input["controller"]>>
}
