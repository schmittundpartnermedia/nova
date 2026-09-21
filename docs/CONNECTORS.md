# Connectoren

Externe Systeme sind nie hart in der Business-Logik verdrahtet.

## Interfaces

- `MailProvider` – send, search, getThread, getMessageUrl
- `CalendarProvider` – list, create, update, cancel, getEventUrl
- `SearchProvider` – `search({ query, language, country, freshness, domains, excludeDomains, limit })` → strukturierte `SearchResult`s (title, url, snippet, publishedAt, source, rank, provider)
- `StorageProvider` – search, read, create, getUrl
- `TaskProvider`
- `ContactsProvider`
- `BrowserProvider`
- `AIProvider`

## V1

Mail, Calendar, Storage, Tasks, Contacts und Browser sind Mock-Implementierungen. Mocks führen **keine** echten Aktionen aus und behaupten das auch nicht.

`SearchProvider` ist produktiv: `OpenAISearchProvider` nutzt OpenAI Web Search über `OPENAI_API_KEY`. Der Research Agent hängt am Interface, nicht am konkreten Anbieter.

`MockMailProvider.send()` gibt `executed: false` zurück.

## Später, organizationsbezogen

Gmail, Outlook, Google Calendar, Microsoft Calendar, Google Drive, OneDrive, lokale Dateien, alternative Search Provider, Browser Automation.

Credentials und Konfigurationen (`ConnectorConfig`) gehören immer zu einer Organization und werden nicht geteilt.
