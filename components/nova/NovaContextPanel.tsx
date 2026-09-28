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

      {section === "chat" || section === "projects" ? (
        <div className="nova-card nova-panel">
          <h3>Aktive Projekte</h3>
          {(world?.projects ?? []).slice(0, 8).map((project) => (
            <NovaProjectCard key={project.id} name={project.name} status={project.status} />
          ))}
          {!world
            ? projects.slice(0, 4).map((project) => (
                <NovaProjectCard key={project.name} name={project.name} status={project.status} />
              ))
            : null}
          {(world ? world.projects.length === 0 : projects.length === 0) ? (
            <p className="nova-empty">Noch keine Projekte.</p>
          ) : null}
        </div>
      ) : null}

      {job && section === "chat" ? (
        <div className="nova-card nova-panel">
          <h3>Aktueller Auftrag</h3>
          <NovaProjectCard name={job.userRequest} status={jobStatusLabel(job.status)} />
        </div>
      ) : null}

      {section === "knowledge" ? (
        <div className="nova-card nova-panel">
          <h3>Wissen</h3>
          {world ? (
            world.knowledge.length === 0 ? (
              <p className="nova-empty">Noch keine Wissenseinträge.</p>
            ) : (
              world.knowledge.slice(0, 8).map((item) => (
                <NovaTaskCard key={item.id} title={item.title} meta={item.source || "Wissen"} />
              ))
            )
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
    </aside>
  );
}
