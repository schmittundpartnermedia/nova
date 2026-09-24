export type NovaSection =
  | "chat"
  | "projects"
  | "companies"
  | "contacts"
  | "tasks"
  | "research"
  | "knowledge"
  | "archive"
  | "approvals";

const ITEMS: Array<{ id: NovaSection; label: string; icon: string }> = [
  { id: "chat", label: "Chat", icon: "M4 6h16v10H7l-3 3V6Z" },
  { id: "projects", label: "Projekte", icon: "M4 7h6l2 2h8v10H4V7Z" },
  { id: "companies", label: "Unternehmen", icon: "M4 20V8l6-4 6 4v12M10 20v-6h4v6" },
  { id: "contacts", label: "Kontakte", icon: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 8a8 8 0 0 0-16 0" },
  { id: "tasks", label: "Aufgaben", icon: "M5 7h14M5 12h14M5 17h9" },
  { id: "research", label: "Recherche", icon: "M11 18a7 7 0 1 1 7-7 7 7 0 0 1-7 7Zm5.5-1.5L21 21" },
  { id: "knowledge", label: "Wissen", icon: "M5 5h14v14H5zM8 8h8M8 12h8M8 16h5" },
  { id: "approvals", label: "Freigaben", icon: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11Z" },
  { id: "archive", label: "Archiv", icon: "M4 7h16v3H4V7Zm2 3v9h12v-9" },
];

export function NovaSidebar({
  section,
  onSection,
  userName,
  open,
  onOpenSettings,
}: {
  section: NovaSection;
  onSection: (section: NovaSection) => void;
  userName: string;
  open?: boolean;
  onOpenSettings?: () => void;
}) {
  const initial = userName.trim().slice(0, 1).toUpperCase() || "N";

  return (
    <aside className={`nova-sidebar nova-panel ${open ? "open" : ""}`}>
      <div className="nova-brand">
        <strong>NOVA</strong>
        <span>Dein Business. Deine KI.</span>
      </div>
      <nav className="nova-nav" aria-label="NOVA">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? "active" : ""}
            onClick={() => onSection(item.id)}
          >
            <span className="nova-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d={item.icon} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </span>
            <span className="label">{item.label}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="nova-upload-nav" onClick={onOpenSettings} title="Dateien hochladen">
        <span className="nova-nav-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4M7 9l5-5 5 5M5 20h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="label">Hochladen</span>
      </button>
      <button type="button" className="nova-user" onClick={onOpenSettings} title="Dateien hochladen">
        <span className="nova-user-mark">{initial}</span>
        <div>
          <strong>{userName || "NOVA"}</strong>
          <small>Dateien hochladen</small>
        </div>
      </button>
    </aside>
  );
}
