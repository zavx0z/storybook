# Вход в среду Завхоз

Все рабочие правила, знания и инструменты предоставляет среда. Перед работой
получи `GET ${origin}/api/environment` и прочитай `result.instructions`.
`origin` и `controlToken` возьми из
`~/Library/Caches/zavx0z-external-storybook/server.json` (либо
`${STORYBOOK_STATE_ROOT}/server.json`, если переменная задана).
Авторизация: `Bearer <controlToken>`; токен не выводить и не сохранять в Git.
Команды отправлять в тот же адрес: `POST {name, arguments}` по выданным схемам.
Если вход недоступен, сообщи об этом; не считай старый контекст действующим.

Правила этого владельца: `storybook/meta/notes/agent-rules.md` относительно Project. Перед правками
прочитай их и правила предков через файловые инструменты среды.
