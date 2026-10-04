/** Контракт авторизованного JSON и NDJSON-клиента HTTP API. */
export declare namespace Zavx0zStorybookTechHttpClient {
  /**
  Адрес и полномочие одного удалённого экземпляра.

  @property origin - Базовый origin API без маршрута конкретной операции.
  @property instanceId - Непрозрачная identity экземпляра, доступная для сопоставления вызывающему коду.
  @property authorization - Возвращает заголовок authorization непосредственно перед запросом.
  Ошибка получения полномочия отклоняет запрос до отправки; способ хранения credentials клиенту неизвестен.
  */
  type Input = Readonly<{origin: string; instanceId: string; authorization(): string}>

  /**
  Авторизованные операции к одному instance сервера. Клиент не запускает и
  не останавливает процесс; результаты JSON остаются непрозрачными данными API.

  @property origin - Origin из переданной записи; не выполняет новый запрос
  и не отслеживает смену работающего daemon.

  @property instanceId - Идентификатор instance из той же записи.

  @property read - Отправляет GET на путь внутри `/api/` с предоставленным authorization.
  Аргумент `signal` отменяет ожидание, внутренний предел составляет 120 секунд.
  Возвращает JSON-объект; неверный путь, не-JSON ответ и HTTP-ошибка отклоняют Promise.

  @property control - Отправляет POST с JSON body на путь внутри `/api/`
  с тем же полномочием и пределом ожидания. Возвращает JSON-объект;
  неверный путь, не-JSON ответ и HTTP-ошибка отклоняют Promise.

  @property controlStream - Отправляет POST и по мере NDJSON-событий ожидает
  необязательный `onProgress` для каждого объекта progress, затем возвращает
  объект result. `signal` закрывает только поток ожидания клиента: серверная
  операция продолжает свой lifecycle. Если сервер ответил обычным JSON,
  возвращает его как совместимый результат. Ошибка HTTP, неверное событие,
  завершение без result или ошибка callback отклоняют Promise.
  */
  type Output = Readonly<{
    origin: string
    instanceId: string
    read(path: string, signal?: AbortSignal): Promise<Record<string, unknown>>
    control(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
    controlStream(
      path: string,
      body: unknown,
      onProgress?: ((progress: Readonly<Record<string, unknown>>) => void | Promise<void>) | undefined,
      signal?: AbortSignal,
    ): Promise<Record<string, unknown>>
  }>
}
