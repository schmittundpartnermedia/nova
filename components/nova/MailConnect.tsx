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

export function MailConnect() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [providers, setProviders] = useState({ google: false, microsoft: false });
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/mail")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { accounts: Account[]; capabilities: Capabilities; providers: { google: { configured: boolean }; microsoft: { configured: boolean } } } | null) => {
          if (!data) return;
          setAccounts(data.accounts);
          setCapabilities(data.capabilities);
          setProviders({ google: data.providers.google.configured, microsoft: data.providers.microsoft.configured });
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function connect(provider: "google" | "microsoft") {
    setMessage("");
    const response = await fetch(`/api/mail/oauth/start?provider=${provider}`);
    const data = (await response.json()) as { ok?: boolean; url?: string; reason?: string };
    if (data.url) {
      window.location.assign(data.url);
      return;
    }
    setMessage(data.reason === "PROVIDER_OAUTH_NOT_CONFIGURED" ? "OAuth ist für diesen Anbieter noch nicht eingerichtet." : "Verbindung blockiert.");
  }

  const connection = capabilities.MAIL_CONNECTION;
  const connected = accounts.filter((item) => item.status === "connected");

  return (
    <div className="nova-card nova-panel">
      <h3>Mail</h3>
      {connection?.reason === "PROVIDER_OAUTH_NOT_CONFIGURED" ? (
        <p className="nova-card-meta">Verbinden blockiert: OAuth-App fehlt beim Anbieter.</p>
      ) : (
        <p className="nova-card-meta">{connected.length ? "Verbunden" : "Noch kein Konto"}</p>
      )}
      {connected.map((account) => (
        <p key={account.id}>
          <strong>{account.emailAddress}</strong>
          <span className="nova-card-meta"> {account.provider === "google" ? "Google" : "Microsoft"} · Verbunden</span>
          {account.lastSyncAt ? <span className="nova-card-meta"> · Sync {account.lastSyncAt.slice(0, 16).replace("T", " ")}</span> : null}
        </p>
      ))}
      <div className="mt-4 flex gap-2" style={{ flexWrap: "wrap" }}>
        <button type="button" className="nova-chip" disabled={!providers.microsoft} onClick={() => void connect("microsoft")}>
          Mit Microsoft verbinden
        </button>
        <button type="button" className="nova-chip" disabled={!providers.google} onClick={() => void connect("google")}>
          Mit Google verbinden
        </button>
      </div>
      {message ? <p className="nova-card-meta">{message}</p> : null}
    </div>
  );
}
