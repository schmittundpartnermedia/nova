# Connectoren

Externe Systeme sind nie hart in der Business-Logik verdrahtet.

## Interfaces

- `MailProvider` – Kontostatus, Ordner, Nachrichten, Threads, Suche, Entwürfe, Versand, Reply, Forward, Anhänge, healthCheck
- `CalendarProvider` – list, create, update, cancel, getEventUrl
- `SearchProvider` – `search({ query, language, country, freshness, domains, excludeDomains, limit })` → strukturierte `SearchResult`s (title, url, snippet, publishedAt, source, rank, provider)
- `StorageProvider` – search, read, create, getUrl
- `TaskProvider`
- `ContactsProvider`
- `BrowserProvider`
- `AIProvider`

## V1

Mail ist produktiv über `ImapSmtpMailProvider` (IMAP lesen, SMTP senden), sobald ein Konto verbunden ist. Ohne Konto ist Mail blockiert, nicht als Mock verfügbar. `MockMailProvider` und `FixtureMailProvider` bleiben Testadapter. Calendar, Storage, Tasks, Contacts und Browser bleiben Mock- oder Lokal-Implementierungen. Mocks führen **keine** echten Aktionen aus und behaupten das auch nicht.

`SearchProvider` ist produktiv: `OpenAISearchProvider` nutzt OpenAI Web Search über `OPENAI_API_KEY`. Der Research Agent hängt am Interface, nicht am konkreten Anbieter.

`MockMailProvider.send()` gibt `executed: false` zurück.

## Später, organizationsbezogen

Gmail, Outlook, Google Calendar, Microsoft Calendar, Google Drive, OneDrive, lokale Dateien, alternative Search Provider, Browser Automation.

Credentials und Konfigurationen (`ConnectorConfig`) gehören immer zu einer Organization und werden nicht geteilt.
