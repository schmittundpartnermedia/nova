"use client";

import { useEffect, useState } from "react";

type Account = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  provider: string;
  lastSyncAt: string | null;
};

type Capabilities = Record<string, { state: string; reason?: string }>;

function label(account: Account) {
  if (account.emailAddress.endsWith("@apple-mail.local")) return account.displayName || "Apple Mail";
  return account.displayName || account.emailAddress;
}

function address(account: Account) {
  if (account.emailAddress.endsWith("@apple-mail.local")) return null;
  return account.emailAddress;
}

export function MailConnect() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    const response = await fetch("/api/mail");
    if (!response.ok) return;
    const data = (await response.json()) as { accounts: Account[]; capabilities: Capabilities };
    setAccounts(data.accounts);
    setCapabilities(data.capabilities);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function connect() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/mail/apple", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; reason?: string; accounts?: Account[]; capabilities?: Capabilities };
    if (data.accounts) setAccounts(data.accounts);
    if (data.capabilities) setCapabilities(data.capabilities);
    if (data.reason === "AUTOMATION_PERMISSION_REQUIRED") {
      setMessage("Apple Mail bleibt blockiert, bis du im macOS-Dialog erlaubst, dass der NOVA Desktop Helper Mail steuert.");
    } else if (data.reason === "AUTOMATION_DENIED") {
      setMessage("macOS blockiert die Mail-Automatisierung. Erlaube den NOVA Desktop Helper unter Datenschutz → Automation.");
    } else if (!data.ok) {
      setMessage("Apple Mail ist gerade nicht erreichbar.");
    }
    setBusy(false);
    await load();
  }

  const connection = capabilities.MAIL_CONNECTION;
  const connected = accounts.filter((item) => item.status === "connected");
  const lastSync = connected
    .map((item) => item.lastSyncAt)
    .filter((item): item is string => Boolean(item))
    .sort()
    .at(-1);

  return (
    <div className="nova-card nova-panel">
      <h3>Apple Mail</h3>
      {connection?.state === "AVAILABLE" ? (
        <p className="nova-card-meta">Verbunden</p>
      ) : connection?.reason === "AUTOMATION_PERMISSION_REQUIRED" ? (
        <p className="nova-card-meta">Blockiert: Automatisierung für Mail fehlt.</p>
      ) : connection?.reason === "AUTOMATION_DENIED" ? (
        <p className="nova-card-meta">Blockiert: Mail-Automatisierung verweigert.</p>
      ) : (
        <p className="nova-card-meta">Noch nicht verbunden</p>
      )}
      {connected.length ? (
        <p>
          <strong>{connected.length} Accounts</strong>
          {lastSync ? <span className="nova-card-meta"> · Sync {lastSync.slice(0, 16).replace("T", " ")}</span> : null}
        </p>
      ) : null}
      {connected.length ? (
        <button type="button" className="nova-chip" onClick={() => setOpen((value) => !value)}>
          {open ? "Accounts ausblenden" : "Accounts anzeigen"}
        </button>
      ) : null}
      {open
        ? connected.map((account) => (
            <p key={account.id}>
              <strong>{label(account)}</strong>
              {address(account) ? <span className="nova-card-meta"> {address(account)}</span> : null}
            </p>
          ))
        : null}
      {connection?.state !== "AVAILABLE" ? (
        <div className="mt-4">
          <button type="button" className="nova-chip" disabled={busy} onClick={() => void connect()}>
            {busy ? "Apple Mail wird gelesen…" : "Apple Mail verbinden"}
          </button>
        </div>
      ) : null}
      {message ? <p className="nova-card-meta">{message}</p> : null}
    </div>
  );
}
