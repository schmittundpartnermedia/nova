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

Mail ist für diese NOVA produktiv über Apple Mail. `AppleMailProvider` spricht Mail.app per Apple Events an. macOS behält die Konten und Zugangsdaten. NOVA speichert keine Passwörter und liest weder die Keychain noch die private Mail-Datenbank. Ohne Automatisierungsfreigabe oder ohne erkanntes Konto ist Mail blockiert. Google- und Microsoft-OAuth bleiben als getrennte Adapter für spätere Organisationen erhalten und sind nicht der normale Weg. `MockMailProvider` und `FixtureMailProvider` bleiben Testadapter. Calendar, Storage, Tasks, Contacts und Browser bleiben Mock- oder Lokal-Implementierungen. Mocks führen **keine** echten Aktionen aus und behaupten das auch nicht.

`SearchProvider` ist produktiv: `OpenAISearchProvider` nutzt OpenAI Web Search über `OPENAI_API_KEY`. Der Research Agent hängt am Interface, nicht am konkreten Anbieter.

`MockMailProvider.send()` gibt `executed: false` zurück.

## Später, organizationsbezogen

Gmail, Outlook, Google Calendar, Microsoft Calendar, Google Drive, OneDrive, lokale Dateien, alternative Search Provider, Browser Automation.

Credentials und Konfigurationen (`ConnectorConfig`) gehören immer zu einer Organization und werden nicht geteilt.
