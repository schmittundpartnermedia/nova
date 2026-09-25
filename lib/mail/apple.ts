export type MailAutomationState = "granted" | "denied" | "required" | "unavailable";

export type AppleCursor = { mode: "apple"; knownIds: string[] };

const RECORD = String.fromCharCode(30);
const FIELD = String.fromCharCode(31);
const ATTACHMENT = String.fromCharCode(29);
const ATTACHMENT_FIELD = String.fromCharCode(28);

const SCRIPT_HELPER = `
on novaClean(rawText)
  set t to rawText as text
  set AppleScript's text item delimiters to linefeed
  set chunks to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks as text
  set AppleScript's text item delimiters to return
  set chunks2 to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks2 as text
  set AppleScript's text item delimiters to character id 31
  set chunks3 to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks3 as text
  set AppleScript's text item delimiters to character id 30
  set chunks4 to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks4 as text
  set AppleScript's text item delimiters to ""
  return t
end novaClean
on novaFlat(rawText)
  set t to rawText as text
  set AppleScript's text item delimiters to character id 31
  set chunks to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks as text
  set AppleScript's text item delimiters to character id 30
  set chunks2 to text items of t
  set AppleScript's text item delimiters to " "
  set t to chunks2 as text
  set AppleScript's text item delimiters to ""
  return t
end novaFlat
on novaStamp(recv)
  try
    set y to year of recv
    set mo to month of recv as integer
    set d to day of recv
    set h to hours of recv
    set mi to minutes of recv
    set s to seconds of recv
    return (y as text) & "-" & (mo as text) & "-" & (d as text) & "T" & (h as text) & ":" & (mi as text) & ":" & (s as text)
  end try
  return ""
end novaStamp
`;

export function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function assertMailScriptSafe(source: string): { ok: true } | { ok: false; reason: string } {
  if (!/tell application "Mail"/i.test(source)) return { ok: false, reason: "Nur Mail.app ist erlaubt." };
  if (/password\s+of|keychain|library\/mail|envelope index|find-generic-password|do shell script/i.test(source)) {
    return { ok: false, reason: "Dieses Mail-Skript ist nicht erlaubt." };
  }
  return { ok: true };
}

export function parseRecords(raw: string): string[][] {
  return raw
    .split(RECORD)
    .map((row) => row.split(FIELD))
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function parseDetail(raw: string): { fields: string[]; body: string } {
  const index = raw.indexOf(RECORD);
  if (index < 0) return { fields: raw.split(FIELD), body: "" };
  return { fields: raw.slice(0, index).split(FIELD), body: raw.slice(index + 1) };
}

export function parseAttachments(raw: string): Array<{ name: string; mime: string; size: number; id: string; downloaded: boolean }> {
  if (!raw.trim()) return [];
  return raw
    .split(ATTACHMENT)
    .map((item) => item.split(ATTACHMENT_FIELD))
    .filter((parts) => parts[0]?.trim())
    .map((parts) => ({
      name: parts[0] ?? "anhang",
      mime: parts[1] || "application/octet-stream",
      size: Number(parts[2] ?? 0) || 0,
      id: parts[3] || parts[0] || "anhang",
      downloaded: parts[4] === "true" || parts[4] === "1",
    }));
}

export function parseMailAddress(raw: string): { name?: string; email: string } {
  const text = raw.trim();
  const wrapped = text.match(/^(.*)<([^>]+)>$/);
  if (wrapped) {
    const name = wrapped[1]?.trim().replace(/^"|"$/g, "");
    return { name: name || undefined, email: wrapped[2]!.trim() };
  }
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return { email, name: text === email ? undefined : text.replace(email, "").trim() || undefined };
  return { email: "" };
}

export function accountEmail(address: string, appleId: string): string {
  const email = address.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  return `account-${appleId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "unknown"}@apple-mail.local`;
}

export function appleRefFromCapabilities(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const hit = parsed.map(String).find((item) => item.startsWith("apple-ref:"));
    return hit ? hit.slice("apple-ref:".length) : null;
  } catch {
    return null;
  }
}

export function visibleCapabilities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter((item) => !item.startsWith("apple-ref:"));
  } catch {
    return [];
  }
}

export type FolderRole = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash" | "other";

export function folderRole(name: string): FolderRole {
  const value = name.trim().toLowerCase();
  if (value === "inbox" || value === "posteingang" || value === "eingang") return "inbox";
  if (/sent|gesendet|gesendete/.test(value)) return "sent";
  if (/draft|entwurf|entwuerfe/.test(value)) return "drafts";
  if (/archive|archiv|alle nachrichten/.test(value)) return "archive";
  if (/junk|spam|werbung/.test(value)) return "spam";
  if (/trash|deleted|papierkorb|geloescht|gelöscht/.test(value)) return "trash";
  return "other";
}

export function threadKey(input: { messageId: string; inReplyTo?: string; references?: string; appleId: string }): {
  key: string;
  basis: "references" | "in-reply-to" | "message-id";
} {
  const refs = (input.references ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("<") || item.includes("@"));
  if (refs[0]) return { key: refs[0], basis: "references" };
  const reply = (input.inReplyTo ?? "").trim();
  if (reply) return { key: reply, basis: "in-reply-to" };
  const messageId = input.messageId.trim();
  if (messageId) return { key: messageId, basis: "message-id" };
  return { key: `apple:${input.appleId}`, basis: "message-id" };
}

export function parseAppleCursor(raw?: string | null): AppleCursor {
  if (!raw) return { mode: "apple", knownIds: [] };
  try {
    const parsed = JSON.parse(raw) as { mode?: string; knownIds?: unknown };
    if (parsed.mode === "apple" && Array.isArray(parsed.knownIds)) {
      return { mode: "apple", knownIds: parsed.knownIds.map(String).filter(Boolean).slice(-500) };
    }
  } catch {
    return { mode: "apple", knownIds: [] };
  }
  return { mode: "apple", knownIds: [] };
}

export function mergeAppleCursor(raw: string | null | undefined, ids: string[]): string {
  const current = parseAppleCursor(raw);
  const knownIds = [...new Set([...current.knownIds, ...ids.filter(Boolean)])].slice(-500);
  return JSON.stringify({ mode: "apple" as const, knownIds });
}

export function localStampToIso(stamp: string): string | undefined {
  const match = stamp.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function deliveryFromVerification(scriptAccepted: boolean, foundInSent: boolean): "VERIFIED" | "FAILED" {
  return scriptAccepted && foundInSent ? "VERIFIED" : "FAILED";
}

export function mailMutationPolicy(action: "read" | "search" | "analyze" | "draft" | "mark-read" | "archive" | "send"): {
  autonomous: boolean;
  approvalRequired: boolean;
} {
  if (action === "send" || action === "archive") return { autonomous: false, approvalRequired: true };
  return { autonomous: true, approvalRequired: false };
}

function quoted(value: string): string {
  return `"${escapeAppleScript(value)}"`;
}

function idClause(id: string): string {
  return /^\d+$/.test(id) ? id : quoted(id);
}

export function accountListScript(): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set out to ""
  repeat with a in accounts
    set addr to ""
    try
      set emails to email addresses of a
      if (count of emails) > 0 then set addr to item 1 of emails as text
    end try
    set flag to "0"
    try
      if enabled of a is true then set flag to "1"
    end try
    set out to out & (id of a as text) & sep & my novaClean(name of a) & sep & my novaClean(addr) & sep & flag & rec
  end repeat
  return out
end tell`;
}

export function mailboxListScript(accountId: string): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set out to ""
  set a to first account whose id is ${quoted(accountId)}
  repeat with b in mailboxes of a
    set unreadN to 0
    try
      set unreadN to unread count of b
    end try
    set out to out & my novaClean(name of b) & sep & (unreadN as text) & rec
  end repeat
  return out
end tell`;
}

export function inboxMetadataScript(accountId: string, limit: number): string {
  const take = Math.min(Math.max(limit, 1), 8);
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set out to ""
  set a to first account whose id is ${quoted(accountId)}
  try
    if exists mailbox "INBOX" of a then
      set box to mailbox "INBOX" of a
      set total to count of messages of box
      set takeN to ${take}
      if total < takeN then set takeN to total
      repeat with i from 1 to takeN
        set m to message i of box
        set mid to ""
        try
          set mid to message id of m
        end try
        set out to out & (id of m as text) & sep & "INBOX" & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (read status of m as text) & sep & my novaClean(mid) & rec
      end repeat
    end if
  end try
  set unified to count of messages of inbox
  set scan to 20
  if unified < scan then set scan to unified
  set seen to 0
  repeat with i from 1 to scan
    if seen ≥ ${take} then exit repeat
    try
      set m to message i of inbox
      set owner to id of account of mailbox of m as text
      if owner is ${quoted(accountId)} then
        set mid to ""
        try
          set mid to message id of m
        end try
        set out to out & (id of m as text) & sep & my novaClean(name of mailbox of m) & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (read status of m as text) & sep & my novaClean(mid) & rec
        set seen to seen + 1
      end if
    end try
  end repeat
  return out
end tell`;
}

export function messageDetailScript(accountId: string, mailbox: string, messageId: string): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set a to first account whose id is ${quoted(accountId)}
  set m to first message of mailbox ${quoted(mailbox)} of a whose id is ${idClause(messageId)}
  set mid to ""
  set inReply to ""
  set refs to ""
  try
    set mid to message id of m
  end try
  try
    repeat with h in headers of m
      set hn to name of h
      if hn is "In-Reply-To" then set inReply to content of h
      if hn is "References" then set refs to content of h
    end repeat
  end try
  set tos to ""
  repeat with r in to recipients of m
    try
      if tos is "" then
        set tos to address of r
      else
        set tos to tos & "," & address of r
      end if
    end try
  end repeat
  set ccs to ""
  repeat with r in cc recipients of m
    try
      if ccs is "" then
        set ccs to address of r
      else
        set ccs to ccs & "," & address of r
      end if
    end try
  end repeat
  set bccs to ""
  repeat with r in bcc recipients of m
    try
      if bccs is "" then
        set bccs to address of r
      else
        set bccs to bccs & "," & address of r
      end if
    end try
  end repeat
  set atts to ""
  set attSep to character id 29
  set attField to character id 28
  repeat with att in mail attachments of m
    try
      set attId to ""
      try
        set attId to id of att as text
      end try
      set attName to name of att
      if attId is "" then set attId to attName
      set attMime to "application/octet-stream"
      try
        set attMime to MIME type of att
      end try
      set attSize to 0
      try
        set attSize to file size of att
      end try
      set attDown to "false"
      try
        set attDown to downloaded of att as text
      end try
      set piece to my novaClean(attName) & attField & my novaClean(attMime) & attField & (attSize as text) & attField & my novaClean(attId) & attField & attDown
      if atts is "" then
        set atts to piece
      else
        set atts to atts & attSep & piece
      end if
    end try
  end repeat
  set bodyText to ""
  try
    set bodyText to content of m as text
    if (length of bodyText) > 20000 then set bodyText to text 1 thru 20000 of bodyText
  end try
  return (id of m as text) & sep & my novaClean(mid) & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (read status of m as text) & sep & my novaClean(tos) & sep & my novaClean(ccs) & sep & my novaClean(bccs) & sep & my novaClean(inReply) & sep & my novaClean(refs) & sep & atts & rec & my novaFlat(bodyText)
end tell`;
}

export function searchInboxScript(accountId: string, term: string): string {
  const needle = term.replace(/[%*_]/g, " ").trim().slice(0, 80);
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set out to ""
  set a to first account whose id is ${quoted(accountId)}
  if exists mailbox "INBOX" of a then
    set hits to messages of mailbox "INBOX" of a whose subject contains ${quoted(needle)}
    set takeN to count of hits
    if takeN > 3 then set takeN to 3
    repeat with i from 1 to takeN
      set m to item i of hits
      set mid to ""
      try
        set mid to message id of m
      end try
      set out to out & (id of m as text) & sep & "INBOX" & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (read status of m as text) & sep & my novaClean(mid) & rec
    end repeat
  end if
  return out
end tell`;
}

export function outgoingDraftScript(input: { accountEmail: string; to: string; subject: string; body: string }): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set msg to make new outgoing message with properties {subject:${quoted(input.subject)}, content:${quoted(input.body)}, visible:false, sender:${quoted(input.accountEmail)}}
  tell msg
    make new to recipient at end of to recipients with properties {address:${quoted(input.to)}}
  end tell
  return id of msg as text
end tell`;
}

export function replyDraftScript(input: {
  accountId: string;
  mailbox: string;
  messageId: string;
  body: string;
  replyAll: boolean;
}): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  set m to first message of mailbox ${quoted(input.mailbox)} of a whose id is ${idClause(input.messageId)}
  set theReply to reply m opening window false reply to all ${input.replyAll ? "true" : "false"}
  set content of theReply to ${quoted(input.body)}
  return id of theReply as text
end tell`;
}

export function forwardDraftScript(input: { accountId: string; mailbox: string; messageId: string; to: string; body: string }): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  set m to first message of mailbox ${quoted(input.mailbox)} of a whose id is ${idClause(input.messageId)}
  set theForward to forward m opening window false
  set content of theForward to ${quoted(input.body)}
  tell theForward
    make new to recipient at end of to recipients with properties {address:${quoted(input.to)}}
  end tell
  return id of theForward as text
end tell`;
}

export function forwardSendScript(input: {
  accountId: string;
  mailbox: string;
  messageId: string;
  to: string;
  body: string;
  sender: string;
}): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  set m to first message of mailbox ${quoted(input.mailbox)} of a whose id is ${idClause(input.messageId)}
  set theForward to forward m opening window false
  set content of theForward to ${quoted(input.body)}
  tell theForward
    make new to recipient at end of to recipients with properties {address:${quoted(input.to)}}
  end tell
  try
    set sender of theForward to ${quoted(input.sender)}
  end try
  set accepted to send theForward
  return accepted as text
end tell`;
}

export function replySendScript(input: {
  accountId: string;
  mailbox: string;
  messageId: string;
  body: string;
  replyAll: boolean;
  sender: string;
}): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  set m to first message of mailbox ${quoted(input.mailbox)} of a whose id is ${idClause(input.messageId)}
  set theReply to reply m opening window false reply to all ${input.replyAll ? "true" : "false"}
  set content of theReply to ${quoted(input.body)}
  try
    set sender of theReply to ${quoted(input.sender)}
  end try
  set accepted to send theReply
  return accepted as text
end tell`;
}

export function newSendScript(input: { sender: string; to: string; subject: string; body: string }): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set msg to make new outgoing message with properties {subject:${quoted(input.subject)}, content:${quoted(input.body)}, visible:false, sender:${quoted(input.sender)}}
  tell msg
    make new to recipient at end of to recipients with properties {address:${quoted(input.to)}}
  end tell
  set accepted to send msg
  return accepted as text
end tell`;
}

export function sentLookupScript(accountId: string, subject: string, recipient: string): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(accountId)}
  set boxes to {}
  repeat with b in mailboxes of a
    set n to name of b
    if n is "Sent" or n is "Sent Messages" or n is "Sent Items" or n is "Gesendet" or n is "Gesendete Objekte" or n is "Gesendete" then set end of boxes to b
  end repeat
  repeat with b in boxes
    set total to count of messages of b
    set takeN to total
    if takeN > 8 then set takeN to 8
    repeat with i from 1 to takeN
      set m to message i of b
      set hitSubject to subject of m as text
      set hitTo to ""
      try
        if (count of to recipients of m) > 0 then set hitTo to address of to recipient 1 of m
      end try
      if hitSubject is ${quoted(subject)} and hitTo contains ${quoted(recipient)} then
        set mid to ""
        try
          set mid to message id of m
        end try
        return mid
      end if
    end repeat
  end repeat
  return ""
end tell`;
}

export function markReadScript(accountId: string, mailbox: string, messageId: string): string {
  return `
tell application "Mail"
  set a to first account whose id is ${quoted(accountId)}
  set read status of (first message of mailbox ${quoted(mailbox)} of a whose id is ${idClause(messageId)}) to true
  return "ok"
end tell`;
}

export function archiveScript(accountId: string, mailbox: string, messageId: string): string {
  return `
tell application "Mail"
  set a to first account whose id is ${quoted(accountId)}
  set targetBox to missing value
  repeat with b in mailboxes of a
    set n to name of b
    if n is "Archive" or n is "Archiv" or n is "Alle Nachrichten" then set targetBox to b
  end repeat
  if targetBox is missing value then return "missing-archive"
  set m to first message of mailbox ${quoted(mailbox)} of a whose id is ${idClause(messageId)}
  move m to targetBox
  return "ok"
end tell`;
}

export function discardOutgoingScript(outgoingId: string): string {
  return `
tell application "Mail"
  set victim to missing value
  repeat with msg in outgoing messages
    if (id of msg as text) is ${quoted(outgoingId)} then set victim to contents of msg
  end repeat
  if victim is missing value then return "missing"
  delete victim
  return "ok"
end tell`;
}

export function saveAttachmentScript(input: {
  accountId: string;
  mailbox: string;
  messageId: string;
  attachmentId: string;
  destination: string;
}): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  set m to first message of mailbox ${quoted(input.mailbox)} of a whose id is ${idClause(input.messageId)}
  repeat with att in mail attachments of m
    if (id of att as text) is ${quoted(input.attachmentId)} then
      save att in POSIX file ${quoted(input.destination)}
      return "ok"
    end if
  end repeat
  return "missing"
end tell`;
}

export function outgoingCheckScript(outgoingId: string): string {
  return `
tell application "Mail"
  repeat with msg in outgoing messages
    if (id of msg as text) is ${quoted(outgoingId)} then
      set n to count of to recipients of msg
      set att to 0
      try
        set att to count of mail attachments of msg
      end try
      return (n as text) & ":" & (att as text)
    end if
  end repeat
  return "missing"
end tell`;
}

export function permissionProbeScript(): string {
  return `tell application "Mail" to get count of accounts`;
}
