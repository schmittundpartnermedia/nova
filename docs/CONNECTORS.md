# Connectoren

Externe Systeme sind nie hart in der Business-Logik verdrahtet.

## Interfaces

- `MailProvider` – send, search, getThread, getMessageUrl
- `CalendarProvider` – list, create, update, cancel, getEventUrl
- `SearchProvider` – search
- `StorageProvider` – search, read, create, getUrl
- `TaskProvider`
- `ContactsProvider`
- `BrowserProvider`
- `AIProvider`

## V1

Nur Mock-Implementierungen. Mocks führen **keine** echten Aktionen aus und behaupten das auch nicht.

`MockMailProvider.send()` gibt `executed: false` zurück.

## Später, organizationsbezogen

Gmail, Outlook, Google Calendar, Microsoft Calendar, Google Drive, OneDrive, lokale Dateien, Web Search, Browser Automation.

Credentials und Konfigurationen (`ConnectorConfig`) gehören immer zu einer Organization und werden nicht geteilt.
