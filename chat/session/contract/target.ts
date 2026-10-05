/**
Адрес без UUID выбирает прежнюю default-беседу. Точная identity исполнителя
выбирает агента этого предмета. sessionId выбирает точную локальную беседу
(chat.id), независимо от приватного native ACP sessionId.
*/
export type Target = string | Readonly<{address: string, executorId: string, sessionId?: string}>
