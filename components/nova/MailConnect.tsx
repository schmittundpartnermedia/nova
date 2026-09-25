"use client";

import { useEffect, useState } from "react";

type Account = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  provider: string;
};

type Capabilities = Record<string, { state: string; reason?: string }>;

export function MailConnect() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/mail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailAddress, password, host: host || undefined }),
    });
    const data = (await response.json()) as { ok?: boolean; reason?: string };
    setBusy(false);
    setPassword("");
    setMessage(data.ok ? "Mailkonto verbunden." : data.reason || "Verbindung fehlgeschlagen.");
    if (data.ok) void load();
  }

  const read = capabilities.MAIL_READ?.state ?? "BLOCKED";

  return (
    <div className="nova-card nova-panel">
      <h3>Mail</h3>
      <p className="nova-card-meta">Lesen {read === "AVAILABLE" ? "verfügbar" : "blockiert"}</p>
      {accounts.filter((item) => item.status === "connected").map((account) => (
        <p key={account.id}>
          <strong>{account.emailAddress}</strong>
          <span className="nova-card-meta"> {account.provider}</span>
        </p>
      ))}
      <form onSubmit={connect} className="mt-4" style={{ display: "grid", gap: 8 }}>
        <input className="nova-mail-input" type="email" required placeholder="E-Mail" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} />
        <input className="nova-mail-input" type="password" required placeholder="Passwort oder App-Passwort" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        <input className="nova-mail-input" placeholder="Mailserver, falls nötig" value={host} onChange={(event) => setHost(event.target.value)} />
        <button className="nova-chip" type="submit" disabled={busy}>
          {busy ? "Verbinde…" : "Mail verbinden"}
        </button>
      </form>
      {message ? <p className="nova-card-meta">{message}</p> : null}
    </div>
  );
}
