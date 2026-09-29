export type MailAutomationState = "granted" | "denied" | "required" | "unavailable";

const RECORD = String.fromCharCode(30);
const FIELD = String.fromCharCode(31);
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
on lowerText(rawText)
  set t to rawText as text
  set lowerChars to "abcdefghijklmnopqrstuvwxyz"
  set upperChars to "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  set out to ""
  repeat with i from 1 to length of t
    set ch to character i of t
    set pos to offset of ch in upperChars
    if pos > 0 then
      set out to out & character pos of lowerChars
    else
      set out to out & ch
    end if
  end repeat
  return out
end lowerText
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

function quoted(value: string): string {
  return `"${escapeAppleScript(value)}"`;
}

function idClause(id: string): string {
  return /^\d+$/.test(id) ? id : quoted(id);
}

function messageResolver(mailbox: string, messageId: string, internetMessageId = ""): string {
  const header = internetMessageId.trim().slice(0, 500);
  return `
  set novaMessage to missing value
  set novaMailbox to ""
  set novaBox to missing value
  if ${quoted(mailbox)} is not "" then
    repeat with b in mailboxes of a
      if (name of b as text) is ${quoted(mailbox)} then
        set novaBox to b
        exit repeat
      end if
    end repeat
  end if
  if novaBox is not missing value and ${quoted(messageId)} is not "" then
    try
      set novaMessage to first message of novaBox whose id is ${idClause(messageId)}
      set novaMailbox to name of novaBox as text
    end try
  end if
  if novaMessage is missing value and ${quoted(header)} is not "" then
    repeat with b in mailboxes of a
      try
        set novaHits to messages of b whose message id is ${quoted(header)}
        if (count of novaHits) > 0 then
          set novaMessage to item 1 of novaHits
          set novaMailbox to name of b as text
          exit repeat
        end if
      end try
    end repeat
  end if
  if novaMessage is missing value then error "nova-message-missing"
  set m to novaMessage`;
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

export function messageDetailScript(accountId: string, mailbox: string, messageId: string, internetMessageId = ""): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set a to first account whose id is ${quoted(accountId)}
  ${messageResolver(mailbox, messageId, internetMessageId)}
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
  return (id of m as text) & sep & my novaClean(mid) & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (read status of m as text) & sep & my novaClean(tos) & sep & my novaClean(ccs) & sep & my novaClean(bccs) & sep & my novaClean(inReply) & sep & my novaClean(refs) & sep & atts & sep & my novaClean(novaMailbox) & rec & my novaFlat(bodyText)
end tell`;
}

export function replySendScript(input: {
  accountId: string;
  mailbox: string;
  messageId: string;
  body: string;
  replyAll: boolean;
  sender: string;
  internetMessageId?: string;
}): string {
  return `${SCRIPT_HELPER}
tell application "Mail"
  set a to first account whose id is ${quoted(input.accountId)}
  ${messageResolver(input.mailbox, input.messageId, input.internetMessageId)}
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
  try
    set end of boxes to sent mailbox of a
  end try
  repeat with b in mailboxes of a
    set n to name of b as text
    set nl to my lowerText(n)
    if nl is "sent" or nl is "sent messages" or nl is "sent items" or nl is "gesendet" or nl is "gesendete objekte" or nl is "gesendete" or nl contains "gesendet" or nl contains "sent" then
      set end of boxes to b
    end if
  end repeat
  set wantSubject to my lowerText(${quoted(subject)})
  set wantTo to my lowerText(${quoted(recipient)})
  repeat with b in boxes
    try
      set total to count of messages of b
      set takeN to total
      if takeN > 40 then set takeN to 40
      repeat with i from 1 to takeN
        set m to message i of b
        set hitSubject to my lowerText(subject of m as text)
        set hitTo to ""
        try
          if (count of to recipients of m) > 0 then set hitTo to my lowerText(address of to recipient 1 of m as text)
        end try
        if hitSubject is wantSubject and (wantTo is "" or hitTo contains wantTo) then
          set mid to ""
          try
            set mid to message id of m
          end try
          if mid is "" then set mid to "sent-confirmed"
          return mid
        end if
      end repeat
    end try
  end repeat
  return ""
end tell`;
}

/**
 * Neueste Nachrichten aus dem gemeinsamen Posteingang aller Konten, neueste zuerst.
 * Felder: id, Konto-id, Postfach, Absender, Betreff, Eingang, gelesen, Message-ID, Textanfang.
 */
export function neuesteNachrichtenScript(input: { anzahl: number; nurUngelesen: boolean }): string {
  const take = Math.min(Math.max(Math.round(input.anzahl), 1), 15);
  const scan = input.nurUngelesen ? 80 : take;
  return `${SCRIPT_HELPER}
tell application "Mail"
  set sep to character id 31
  set rec to character id 30
  set out to ""
  set total to count of messages of inbox
  set scanN to ${scan}
  if total < scanN then set scanN to total
  set seen to 0
  repeat with i from 1 to scanN
    if seen ≥ ${take} then exit repeat
    try
      set m to message i of inbox
      set isRead to read status of m
      if ${input.nurUngelesen ? "isRead is false" : "true"} then
        set mid to ""
        try
          set mid to message id of m
        end try
        set excerpt to ""
        try
          set bodyText to content of m as text
          if (length of bodyText) > 400 then set bodyText to text 1 thru 400 of bodyText
          set excerpt to bodyText
        end try
        set out to out & (id of m as text) & sep & (id of account of mailbox of m as text) & sep & my novaClean(name of mailbox of m) & sep & my novaClean(sender of m) & sep & my novaClean(subject of m) & sep & my novaStamp(date received of m) & sep & (isRead as text) & sep & my novaClean(mid) & sep & my novaClean(excerpt) & rec
        set seen to seen + 1
      end if
    end try
  end repeat
  return out
end tell`;
}
