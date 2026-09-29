const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{8,}/g,
  /sk-ant-[a-zA-Z0-9_-]{8,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|STRIPE|DATABASE|NOVA_DESKTOP)_?(?:API_)?KEY\s*[:=]\s*\S+/gi,
  /(?:api[_-]?key|secret|password|token|passwd)\s*[:=]\s*["']?[^"' \n]{8,}/gi,
  /Bearer\s+[a-zA-Z0-9._\-+=/]{12,}/g,
];

const ENV_LINE = /^([A-Z0-9_]+)\s*=\s*(.*)$/;

export function redactSecrets(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

export function redactEnvFile(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const match = ENV_LINE.exec(line);
      if (!match) return redactSecrets(line);
      const key = match[1];
      if (/KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE/i.test(key)) {
        return `${key}=[redacted]`;
      }
      return redactSecrets(line);
    })
    .join("\n");
}

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/key|secret|token|password|cookie|authorization|credential/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactUnknown(nested, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function shouldRedactFilePath(filePath: string): boolean {
  return /(?:^|\/)\.env(?:\.|$)|\.pem$|id_rsa|id_ed25519|credentials|\.netrc|cookies?\.sqlite/i.test(filePath);
}
