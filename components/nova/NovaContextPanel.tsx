import { MailConnect } from "@/components/nova/MailConnect";
import { NovaProjectCard } from "@/components/nova/NovaProjectCard";
import { NovaTaskCard } from "@/components/nova/NovaTaskCard";
import type { NovaSection } from "@/components/nova/NovaSidebar";
import type { ArchiveItem } from "@/components/archive/ArchivePanel";

export type NovaJobSummary = {
  id: string;
  goal: string;
  status: string;
  userRequest: string;
};

export type NovaWorld = {
  projects: Array<{ id: string; name: string; status: string }>;
  contacts: Array<{ id: string; name: string; role: string | null }>;
  companies: Array<{ id: string; name: string; industry: string | null }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null }>;
  knowledge: Array<{ id: string; title: string; source: string }>;
  research: Array<{ id: string; title: string; status: string }>;
};

export type NovaStandingPolicy = {
  id: string;
  name: string;
  actionType: string;
  label: string;
};

function jobStatusLabel(status: string) {
  if (status === "running" || status === "planning") return "In Bearbeitung";
  if (status === "waiting_for_approval") return "Wartet auf Freigabe";
  if (status === "waiting_for_review") return "Wartet auf Prüfung";
  if (status === "paused") return "Pausiert";
  if (status === "completed") return "Abgeschlossen";
  if (status === "failed") return "Nicht abgeschlossen";
  if (status === "cancelled") return "Abgebrochen";
  return "Offen";
}

function formatStamp(iso: string) {
  if (iso.length < 16) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}. ${iso.slice(11, 16)}`;
}

function uniqueByName(items: Array<{ name: string; status: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export function NovaContextPanel({
  open,
  section,
  online,
  statusText,
  job,
  approvalDescription,
  items,
  world,
  standingPolicies = [],
  standingBusy = false,
  onGrantStanding,
  onRevokeStanding,
  onUpload,
}: {
  open?: boolean;
  section: NovaSection;
  online: boolean;
  statusText: string;
  job: NovaJobSummary | null;
  approvalDescription: string | null;
  items: ArchiveItem[];
  world?: NovaWorld | null;
  standingPolicies?: NovaStandingPolicy[];
  standingBusy?: boolean;
  onGrantStanding?: (actionType: "mail.send.batch" | "macos.ui.click") => void;
  onRevokeStanding?: (policyId: string) => void;
  onUpload?: () => void;
}) {
  const projects = uniqueByName(
    items.filter((item) => item.project?.name).map((item) => ({ name: item.project!.name, status: item.status })),
  );
  const companies = uniqueByName(
    items.filter((item) => item.company?.name).map((item) => ({ name: item.company!.name, status: item.status })),
  );
  const contacts = uniqueByName(
    items
      .filter((item) => item.contact)
      .map((item) => ({
        name: `${item.contact!.firstName} ${item.contact!.lastName}`.trim(),
        status: item.contact?.role ?? item.status,
      })),
  );
  const tasks = items.filter((item) => item.type === "task" || item.task);
  const research = items.filter((item) => item.type === "research");
  const knowledge = items.filter((item) => item.type === "memory" || item.type === "document");

  return (
    <aside className={`nova-context ${open ? "open" : ""}`}>
      <div className="nova-card nova-panel">
        <div className="nova-online">
          <div>
            <h3>NOVA</h3>
            <p className="nova-card-meta">{online ? statusText : "Nicht erreichbar"}</p>
          </div>
          <span className={`nova-dot ${online ? "" : "off"}`} />
        </div>
      </div>

      {approvalDescription ? (
        <div className="nova-card nova-panel">
          <h3>Freigabe erforderlich</h3>
          <p className="nova-quote">{approvalDescription}</p>
        </div>
      ) : null}

      {section === "mail" ? <MailConnect /> : null}

      {section === "approvals" ? (
        <div className="nova-card nova-panel">
          <h3>Dauerfreigaben</h3>
          {standingPolicies.length === 0 ? (
            <p className="nova-empty">Keine Dauerfreigaben. Einzeln freigegebene Aktionen bleiben einzeln.</p>
          ) : (
            standingPolicies.map((policy) => (
              <div key={policy.id} className="mt-4" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div>
                  <strong>{policy.label}</strong>
                  <p className="nova-card-meta">{policy.name}</p>
                </div>
                <button
                  type="button"
                  className="nova-chip"
                  disabled={standingBusy}
                  onClick={() => onRevokeStanding?.(policy.id)}
                >
                  Widerrufen
                </button>
              </div>
            ))
          )}
          <div className="mt-4 flex gap-2" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="nova-chip"
              disabled={standingBusy || standingPolicies.some((item) => item.actionType === "mail.send.batch")}
              onClick={() => onGrantStanding?.("mail.send.batch")}
            >
              Mails immer erlauben
            </button>
            <button
              type="button"
              className="nova-chip"
              disabled={standingBusy || standingPolicies.some((item) => item.actionType === "macos.ui.click")}
              onClick={() => onGrantStanding?.("macos.ui.click")}
            >
              Klicks immer erlauben
            </button>
          </div>
        </div>
      ) : null}

      {section === "chat" || section === "projects" ? (
        <div className="nova-card nova-panel">
          <h3>Aktive Projekte</h3>
          {(world?.projects ?? []).slice(0, 8).map((project) => (
            <NovaProjectCard key={project.id} name={project.name} status={project.status} />
          ))}
          {!world ? projects.slice(0, 4).map((project) => (
            <NovaProjectCard key={project.name} name={project.name} status={project.status} />
          )) : null}
          {(world ? world.projects.length === 0 : projects.length === 0) ? <p className="nova-empty">Noch keine Projekte.</p> : null}
        </div>
      ) : null}

      {section === "chat" || section === "tasks" ? (
        <div className="nova-card nova-panel">
          <h3>Nächste Aufgabe</h3>
          {world ? (
            world.tasks[0] ? (
              <NovaTaskCard title={world.tasks[0].title} meta={world.tasks[0].status} />
            ) : (
              <p className="nova-empty">Keine offene Aufgabe.</p>
            )
          ) : tasks[0] ? (
            <NovaTaskCard
              title={tasks[0].task?.title ?? tasks[0].title}
              meta={formatStamp(tasks[0].timestamp)}
            />
          ) : (
            <p className="nova-empty">Keine Aufgabe im Archiv.</p>
          )}
        </div>
      ) : null}

      {job && section === "chat" ? (
        <div className="nova-card nova-panel">
          <h3>Aktueller Auftrag</h3>
          <NovaProjectCard name={job.userRequest} status={jobStatusLabel(job.status)} />
        </div>
      ) : null}

      {section === "companies" ? (
        <div className="nova-card nova-panel">
          <h3>Unternehmen</h3>
          {world ? (
            world.companies.length === 0 ? <p className="nova-empty">Keine Unternehmen.</p> : world.companies.slice(0, 8).map((company) => (
              <NovaProjectCard key={company.id} name={company.name} status={company.industry ?? "Unternehmen"} />
            ))
          ) : (
            <>
              {companies.length === 0 ? <p className="nova-empty">Keine Unternehmen im Archiv.</p> : null}
              {companies.slice(0, 8).map((company) => (
                <NovaProjectCard key={company.name} name={company.name} status={company.status} />
              ))}
            </>
          )}
        </div>
      ) : null}

      {section === "contacts" ? (
        <div className="nova-card nova-panel">
          <h3>Kontakte</h3>
          {world ? (
            world.contacts.length === 0 ? <p className="nova-empty">Keine Kontakte.</p> : world.contacts.slice(0, 8).map((contact) => (
              <NovaProjectCard key={contact.id} name={contact.name} status={contact.role ?? "Kontakt"} />
            ))
          ) : (
            <>
              {contacts.length === 0 ? <p className="nova-empty">Keine Kontakte im Archiv.</p> : null}
              {contacts.slice(0, 8).map((contact) => (
                <NovaProjectCard key={contact.name} name={contact.name} status={contact.status} />
              ))}
            </>
          )}
        </div>
      ) : null}

      {section === "research" ? (
        <div className="nova-card nova-panel">
          <h3>Recherche</h3>
          {world ? (
            world.research.length === 0 ? <p className="nova-empty">Keine Recherche.</p> : world.research.slice(0, 8).map((item) => (
              <NovaTaskCard key={item.id} title={item.title} meta={item.status} />
            ))
          ) : (
            <>
              {research.length === 0 ? <p className="nova-empty">Keine Recherche im Archiv.</p> : null}
              {research.slice(0, 8).map((item) => (
                <NovaTaskCard key={item.id} title={item.title} meta={item.status} />
              ))}
            </>
          )}
        </div>
      ) : null}

      {section === "knowledge" ? (
        <div className="nova-card nova-panel">
          <h3>Wissen</h3>
          {world ? (
            world.knowledge.length === 0 ? <p className="nova-empty">Noch keine Wissenseinträge.</p> : world.knowledge.slice(0, 8).map((item) => (
              <NovaTaskCard key={item.id} title={item.title} meta={item.source || "Wissen"} />
            ))
          ) : (
            <>
              {knowledge.length === 0 ? <p className="nova-empty">Noch keine Wissenseinträge im Archiv.</p> : null}
              {knowledge.slice(0, 8).map((item) => (
                <NovaTaskCard key={item.id} title={item.title} meta={item.status} />
              ))}
            </>
          )}
          {onUpload ? (
            <button type="button" className="nova-chip" style={{ marginTop: 12 }} onClick={onUpload}>
              Dateien hochladen
            </button>
          ) : null}
        </div>
      ) : null}

      {section === "tasks" && (world ? world.tasks.length > 1 : tasks.length > 1) ? (
        <div className="nova-card nova-panel">
          <h3>Weitere Aufgaben</h3>
          {world
            ? world.tasks.slice(1, 8).map((item) => (
                <NovaTaskCard key={item.id} title={item.title} meta={item.status} />
              ))
            : tasks.slice(1, 6).map((item) => (
                <NovaTaskCard key={item.id} title={item.task?.title ?? item.title} meta={item.status} />
              ))}
        </div>
      ) : null}
    </aside>
  );
}
