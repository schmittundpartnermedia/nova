export type HardBlockReason = {
  blocked: true;
  code: string;
  message: string;
};

const HARD_BLOCK_PATTERNS: Array<{ code: string; message: string; pattern: RegExp }> = [
  {
    code: "credential_extraction",
    message: "NOVA liest keine Passwörter, Keychain-Inhalte oder Session-Tokens aus.",
    pattern: /keychain|dump.?password|extract.?cookie|session.?token|login.?item/i,
  },
  {
    code: "ssh_exfil",
    message: "SSH-Schlüssel und ~/.ssh dürfen nicht hochgeladen oder nach außen übertragen werden.",
    pattern: /~\/\.ssh|\.ssh\/|id_rsa|id_ed25519|authorized_keys/i,
  },
  {
    code: "security_bypass",
    message: "macOS- oder Browser-Sicherheitsmechanismen dürfen nicht umgangen werden.",
    pattern: /sip.?off|gatekeeper.?off|tccutil.?reset|disable.?sip|umgeh.*sicherheit/i,
  },
  {
    code: "covert_surveillance",
    message: "Verdeckte dauerhafte Bildschirmaufnahme oder heimliche Überwachung ist blockiert.",
    pattern: /heimliche? überwachung|hidden.?screen.?record|covert.?record|verdeckt.*aufnahme/i,
  },
  {
    code: "secret_to_model",
    message: "Geheimnisse dürfen nicht an das Modell oder nach außen gesendet werden.",
    pattern: /upload.*(api.?key|\.env|secret)|send.*(credentials|passwort|password)/i,
  },
  {
    code: "delete_repository",
    message: "Ein Repository oder Projektordner wird nicht gelöscht.",
    pattern: /lösch.*(?:nova-?projekt|repository|repo\b)|delete.*(?:repository|repo\b|nova.?project)/i,
  },
  {
    code: "delete_elevum",
    message: "Daten auf der Festplatte ELEVUM werden niemals gelöscht — auch nicht mit Freigabe.",
    pattern:
      /(?:lösch|entferne|rm\s+-|delete|remove).{0,80}elevum|elevum.{0,80}(?:lösch|entferne|löschen|delete|remove)|\/Volumes\/ELEVUM.{0,40}(?:lösch|rm\s|delete)/i,
  },
  {
    code: "force_push_deploy",
    message: "git push, force push und Production-Deploys sind ohne Freigabe hart blockiert.",
    pattern: /git\s+push\s+[^\n]*--force|--force(?:-with-lease)?|force.?push|deploy.*prod|production.?deploy/i,
  },
];

export function detectHardBlock(text: string): HardBlockReason | null {
  const value = text.trim();
  if (!value) return null;
  for (const entry of HARD_BLOCK_PATTERNS) {
    if (entry.pattern.test(value)) {
      return { blocked: true, code: entry.code, message: entry.message };
    }
  }
  return null;
}

/** Geheimnisse / Systempfade — kein Zugriff. */
export function isHardBlockedPath(target: string): boolean {
  return /(?:^|\/)\.ssh(?:\/|$)|(?:^|\/)\.gnupg(?:\/|$)|keychain|cookies\.sqlite|(?:^|\/)private\/var\/db\/receipts/i.test(
    target,
  );
}

/** Projekt-Festplatte ELEVUM: Lesen/Schreiben ok, Löschen nie. */
export function isProtectedProjectVolumePath(target: string): boolean {
  const value = target.trim();
  if (!value) return false;
  const normalized = value.replace(/\\/g, "/");
  return (
    /(^|\/)Volumes\/ELEVUM(\/|$)/i.test(normalized) ||
    /(^|\/)ELEVUM(\/Projekte|\/Unternehmen|\/Entwicklung|\/NOVA)(\/|$)/i.test(normalized)
  );
}

export function isDestructiveElevumAction(action: string, target: string, argv: string[] = []): boolean {
  const destructiveAction = /^(delete|deleteRecursive|rm|rmdir|unlink|trash)$/i.test(action);
  const destructiveArgv =
    argv.some((part) => /^(rm|rmdir|unlink)$/i.test(part)) || argv.some((part) => /^-rf$|^-fr$/.test(part));
  if (!destructiveAction && !destructiveArgv) return false;
  if (isProtectedProjectVolumePath(target)) return true;
  return argv.some((part) => isProtectedProjectVolumePath(part));
}
