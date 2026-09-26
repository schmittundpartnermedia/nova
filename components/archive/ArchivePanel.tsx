"use client";

import { useMemo, useState } from "react";

export type ArchiveItem = {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  description?: string | null;
  status: string;
  externalUrl?: string | null;
  company?: { name: string } | null;
  communication?: { subject: string; status: string } | null;
  task?: { title: string } | null;
  project?: { name: string } | null;
  contact?: { firstName: string; lastName: string; role?: string | null } | null;
};

const FILTERS = [
  { id: "all", label: "Alle" },
  { id: "conversation", label: "Gespräch" },
  { id: "research", label: "Recherche" },
  { id: "task", label: "Aufgaben" },
  { id: "project_activity", label: "Projekte" },
  { id: "communication", label: "Kommunikation" },
  { id: "decision", label: "Entscheidungen" },
  { id: "approval", label: "Freigaben" },
  { id: "execution", label: "Ausführung" },
  { id: "computer", label: "Computer" },
  { id: "coding", label: "Coding" },
] as const;

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Heute";
  if (sameDay(date, yesterday)) return "Gestern";
  return date.toLocaleDateString("de-DE", { weekday: "long" });
}

function statusLabel(status: string) {
  if (status === "executed") return "Ausgeführt";
  if (status === "failed") return "Nicht ausgeführt";
  if (status === "prepared") return "Vorbereitet";
  if (status === "suggested") return "Vorgeschlagen";
  return status;
}

export function ArchivePanel({
  open,
  onClose,
  items,
  loading,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  items: ArchiveItem[];
  loading: boolean;
  onSearch: (query: string, type: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const grouped = useMemo(() => {
    const map = new Map<string, ArchiveItem[]>();
    for (const item of items) {
      const key = dayLabel(item.timestamp);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-[440px] flex-col border-l border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.92)] backdrop-blur-xl transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <header className="flex items-center justify-between px-6 py-5">
        <h2 className="text-[13px] font-medium tracking-[0.18em] text-white/50 uppercase">Archiv</h2>
        <button type="button" onClick={onClose} className="text-white/40 transition hover:text-white/80" aria-label="Schließen">
          ✕
        </button>
      </header>
      <div className="px-6">
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            onSearch(next, filter);
          }}
          placeholder="Suchen …"
          className="w-full rounded-full border border-white/8 bg-white/4 px-4 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/25"
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setFilter(item.id);
                onSearch(query, item.id);
              }}
              className={`rounded-full px-3 py-1 text-[11px] tracking-wide ${
                filter === item.id ? "bg-white/12 text-white/85" : "text-white/35 hover:text-white/60"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-10">
        {loading ? (
          <p className="pt-8 text-[13px] text-white/30">Laden …</p>
        ) : items.length === 0 ? (
          <p className="pt-8 text-[13px] text-white/30">Noch keine Aktivitäten.</p>
        ) : (
          grouped.map(([day, list]) => (
            <section key={day} className="mb-8">
              <h3 className="mb-3 text-[11px] tracking-[0.16em] text-white/30 uppercase">{day}</h3>
              <ol className="space-y-4">
                {list.map((item) => (
                  <li key={item.id} className="border-l border-white/10 pl-4">
                    <p className="text-[11px] text-white/30">
                      {new Date(item.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="mt-0.5 text-[14px] text-white/85">{item.title}</p>
                    {item.description ? (
                      <p className="mt-1 text-[12px] leading-5 text-white/40">{item.description}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-white/28">{statusLabel(item.status)}</p>
                    {item.externalUrl ? (
                      <a href={item.externalUrl} className="mt-1 inline-block text-[12px] text-white/55 underline decoration-white/20">
                        Original öffnen
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
