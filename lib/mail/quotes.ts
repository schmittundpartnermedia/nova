const QUOTE_LINE = /^(?:>+\s?)/;
const WROTE = /^(am .+ schrieb.+:|on .+ wrote:|from:\s|gesendet:\s|sent:\s|-----original message-----|----- weitergeleitete nachricht -----|----- forwarded message -----)/i;
const SIGNATURE = /^(--|__|mit freundlichen grüßen|freundliche grüße|beste grüße|viele grüße|kind regards|best regards|sincerely)/i;
const DISCLAIMER = /(diese e-mail.*(vertraulich|confidential)|this (e-?mail|message).*(confidential|intended only)|haftungsausschluss|disclaimer)/i;

export function extractNewMessage(text: string): { fresh: string; quoted: boolean; signature: boolean; disclaimer: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let quoted = false;
  let signature = false;
  let disclaimer = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (QUOTE_LINE.test(trimmed) || WROTE.test(trimmed)) {
      quoted = true;
      break;
    }
    if (SIGNATURE.test(trimmed)) {
      signature = true;
      break;
    }
    if (DISCLAIMER.test(trimmed)) {
      disclaimer = true;
      break;
    }
    kept.push(trimmed);
  }
  return {
    fresh: kept.join("\n").trim(),
    quoted,
    signature,
    disclaimer,
  };
}
