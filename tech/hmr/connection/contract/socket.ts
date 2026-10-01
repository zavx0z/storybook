/**
Форма соединения, доступная потребителю через `HmrConnection.Input["socket"]`.

@property addEventListener - Подключает обработчик события по имени; HMR использует open, message и close.

@property removeEventListener - Снимает тот же обработчик с события при замене соединения или завершении.

@property send - Передаёт строку сообщения; формат подписки определяет вызывающий владелец.

@property close - Закрывает принадлежащее lifecycle соединение после снятия обработчиков.
Ошибки транспортных методов сохраняют поведение предоставленного соединения.
*/
export type HmrSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>
