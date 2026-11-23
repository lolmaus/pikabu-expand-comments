# Store Listing Copy (Chrome Web Store & Firefox Add-ons)

Bilingual listing copy for Chrome Web Store (CWS) and Firefox Add-ons (AMO).

---

## English (`en` / `en-US`)

### Name

`Pikabu Expand Comments`

### Short Summary (≤ 132 chars for CWS, ≤ 250 chars for AMO)

`Expand all comments and nested reply branches on Pikabu.ru post pages with one click or automatically on visit.`

### Full Description

```text
Pikabu Expand Comments adds native-looking controls to Pikabu.ru post pages (both desktop and mobile) so you can expand every hidden comment batch and collapsed reply branch in one click — or automatically whenever you open a post.

Key features:
• One-click expansion from the comment tab bar, the bottom of the comment list, or the browser toolbar popup.
• Full support for both desktop and mobile Pikabu post pages (including Firefox for Android and Edge for Android).
• Optional "Auto-expand on visit" setting stored locally per device, synced live between the toolbar popup and on-page settings.
• Preserves your reading scroll position while comments hydrate above your viewport and respects branches you collapse manually.
• Instant Stop / Continue / Retry controls with live open/total comment counts and automatic floating Stop when scrolled away.
• Privacy-first: zero data collection, zero analytics, zero background worker, and open-source code.
```

---

## Русский (`ru`)

### Название

`Pikabu Expand Comments`

### Краткое описание (≤ 132 символов для CWS)

`Раскрывает все комментарии и вложенные ветки на страницах постов Pikabu.ru в один клик или автоматически при открытии.`

### Полное описание

```text
Pikabu Expand Comments добавляет нативные элементы управления на страницы постов Pikabu.ru (в десктопной и мобильной версиях), позволяя раскрывать все скрытые комментарии и свёрнутые ветки ответов одним нажатием — или автоматически при открытии поста.

Основные возможности:
• Раскрытие в один клик из шапки комментариев, нижней панели или меню значка расширения на панели браузера.
• Полная поддержка десктопной и мобильной версий Pikabu (включая Firefox для Android и Edge для Android).
• Настройка «Раскрывать при открытии поста» хранится локально на каждом устройстве и мгновенно синхронизируется между меню значка и настройками на странице.
• Сохраняет позицию чтения при подгрузке комментариев выше экрана и уважает ветки, которые вы свернули вручную.
• Удобные кнопки «Остановить», «Продолжить» и «Повторить», живой счётчик открытых комментариев и плавающая кнопка остановки при прокрутке.
• Полная приватность: без сбора данных, без аналитики, без фонового процесса, открытый исходный код.
```

---

## Chrome Web Store Privacy Practices & Permission Justifications

### Single Purpose Description

`Expand collapsed comment batches and nested reply branches on Pikabu.ru post pages.`

### Permission Justifications

- **`storage`**: Stores a single local boolean preference (`autoExpandOnVisit`) on the user's device and synchronizes changes between the toolbar popup and the Pikabu post page content script.
- **`activeTab`**: Allows the toolbar popup, only when explicitly clicked by the user, to query the currently active tab and communicate with the content script on an open `https://pikabu.ru/story/*` page to show the live open/total comment counter and trigger Expand or Stop.
- **Host access (`https://pikabu.ru/story/*` via static `content_scripts`)**: Required to mount the on-page expansion controls and click Pikabu's public comment-loading buttons inside Pikabu post pages.
- **Remote code**: `No, I am not using remote code.` All extension code is bundled statically inside the uploaded package.
- **Privacy Policy URL**: `https://github.com/lolmaus/pikabu-expand-comments/blob/main/PRIVACY.md`
