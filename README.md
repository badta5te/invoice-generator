# Invoice Generator

Генератор инвойсов за разработку ПО. Форма слева, живой предпросмотр PDF справа, кнопка «Скачать PDF».
Все поля редактируются: номер, даты, реквизиты отправителя и клиента, строки работ (часы × ставка),
налог, примечания (банковские реквизиты), валюта, формат чисел и дат, цвет акцента и все подписи в PDF.

PDF собирается прямо в браузере (pdf-lib + встроенные шрифты Lora, Inter, JetBrains Mono с кириллицей),
поэтому на Cloudflare это просто статический сайт без серверного кода. Данные хранятся в `localStorage`
этого браузера; есть история скачанных инвойсов и экспорт/импорт JSON для бэкапа.

## Команды

```sh
npm install
npm run dev        # сборка + wrangler dev на http://localhost:8787
npm test           # юнит-тесты расчётов и форматирования
npm run typecheck
npm run sample     # sample.pdf с демо-данными, без браузера
npm run deploy     # сборка + wrangler deploy
```

## Деплой на Cloudflare

Автоматически: каждый пуш в `main` проходит проверки и деплоится через GitHub Actions
(`.github/workflows/ci.yml`). Нужны два секрета репозитория
(Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — токен из шаблона «Edit Cloudflare Workers»
  (dash.cloudflare.com → My Profile → API Tokens → Create Token);
- `CLOUDFLARE_ACCOUNT_ID` — Account ID со страницы Workers & Pages в дашборде.

Без секретов деплой пропускается с предупреждением, проверки всё равно идут.

Вручную: `npx wrangler login`, затем `npm run deploy`.

Приложение будет доступно на `https://invoice-generator.<subdomain>.workers.dev`.
Запросы к статическим ассетам Workers бесплатны.
Сайт публичный, но данные инвойсов никуда не уходят из браузера. Чтобы закрыть сам сайт,
можно включить Cloudflare Access (Zero Trust) на этот домен.

## Устройство

- `src/invoice.ts` — модель инвойса, расчёт сумм, форматирование, следующий номер.
- `src/pdf.ts` — отрисовка PDF (A4, вёрстка по образцу, перенос строк, многостраничность).
- `src/app.ts` — форма, предпросмотр, localStorage, история, импорт/экспорт.
- `public/` — `index.html`, `style.css`, шрифты; `app.js` собирается esbuild.

Шрифты распространяются по лицензии SIL Open Font License 1.1 и урезаны до латиницы и кириллицы.
