import type {AppWeb} from "@app/web"

/**
Типовой контракт контейнера приложения Storybook.

- {@link StorybookApp.Input} подключает функции подготовки, извлечения версий и публикации Web.
  Его параметр `Prepared` связывает результат подготовки с аргументами последующих функций.
- {@link StorybookApp.Output} предоставляет `rebuildWeb`, `status`, `subscribe` и `dispose`
  для управления общей операцией и её временем жизни.

Контейнер сохраняет контракт своей части {@link AppWeb}; подробности членов каждой
формы собраны в её родительском описании, доступном при наведении на `Input` или `Output`.
*/
export declare namespace StorybookApp {
  /**
  Функции подготовки и публикации, передаваемые контейнером своей части Web.

  @typeParam Prepared - Результат `web.prepare` после `await`.
  Сохраняет связь с аргументами `web.versions` и `web.publish` в {@link AppWeb.Input};
  контейнер передаёт эти функции Web без изменения их типов или данных.

  @property web - Реализации подготовки, извлечения версий и публикации от вызывающего кода.
  Создание приложения подключает их; подготовка начинается при `rebuildWeb`.

  @see [Действующее подключение в сервере](../../server/server.ts): `prepare` вызывает
  `checkSharedHosts`, а `Prepared` соответствует массиву подготовленных `SharedBrowserAssets`.
  */
  type Input<Prepared> = Readonly<{web: AppWeb.Input<Prepared>}>

  /**
  Управление выпуском Web через контейнер приложения.
  Параметры, ошибки и время жизни операций сохраняют контракт {@link AppWeb.Output}.

  @property rebuildWeb - Передаёт запрос подготовки и применения в `AppWeb.Output.rebuild`.
  Аргумент `options` с `apply: true` запрашивает публикацию; без него выполняется подготовка.
  Конкурентные обращения разделяют одну операцию Web. Promise возвращает её итоговый снимок;
  ошибка подготовки, публикации или завершение приложения отклоняет Promise.

  @property status - Собирает состояние принадлежащих приложению частей без запуска подготовки.
  Аргументов нет; возвращается неизменяемая оболочка с текущим снимком Web в поле `web`.

  @property subscribe - Передаёт наблюдателя в `AppWeb.Output.subscribe`.
  Аргумент `listener` сразу получает состояние Web, совпадающее со значением `status().web`,
  и дальнейшие обновления. Возвращаемая функция удаляет подписку без отмены подготовки.
  Ошибки наблюдателя обрабатываются по {@link AppWeb.Output}.

  @property dispose - Завершает принадлежащую приложению операцию Web и освобождает её подписки.
  Аргументов нет; возвращается Promise `AppWeb.Output.dispose`, включающий ожидание отменяемой подготовки.
  Повторный вызов допустим; новые запросы пересборки запрещены с начала завершения.
  */
  type Output = Readonly<{
    rebuildWeb: AppWeb.Output["rebuild"]
    status(): Readonly<{web: ReturnType<AppWeb.Output["read"]>}>
    subscribe: AppWeb.Output["subscribe"]
    dispose(): Promise<void>
  }>
}
