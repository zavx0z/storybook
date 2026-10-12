import type {Stream} from "@agentclientprotocol/sdk"

/**
Готовый двунаправленный ACP SDK stream с принадлежащим ему освобождением.
Владение переходит подключению после успешной общей валидации входа подключения.

@property stream - Штатные сообщения ACP SDK, без нового протокола сессии.

@property closed - Завершается при утрате транспорта. Rejection сохраняет причину
отказа; normal completion также завершает pending requests ошибкой соединения.

@property dispose - Освобождает только принадлежащий соединению транспорт.
Вызывается один раз при startup failure, утрате транспорта, abort либо явном освобождении.
Не обязан закрывать общую peer network, слушатель или соседние сессии.
*/
export type OwnedStream = Readonly<{stream: Stream, closed: Promise<unknown>, dispose(): Promise<void>}>
