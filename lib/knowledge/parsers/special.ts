import path from "node:path";
import type {
  KnowledgeParser,
  ParsedDocument,
  ParsedSection,
} from "@/types/knowledge";
import { inspectUntrustedDocument, isSecretPath, languageOf, redactKnowledgeText, shouldIgnoreName } from "@/lib/knowledge/security";
import { asRawConversations, reconstructConversation } from "@/lib/chatgpt/graph";
import { unzipSync } from "@/lib/knowledge/zip";

export const zipParser: KnowledgeParser = {
  id: "zip",
  supports(source) {
    return source.sourceType === "zip" || /\.zip$/i.test(source.name);
  },
  async parse(source) {
    const entries = unzipSync(source.bytes).filter((entry) => !entry.directory);
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => !shouldIgnoreName(path.basename(name)) && !isSecretPath(name));
    const listing = names.slice(0, 200).join("\n");
    const fulltext = redactKnowledgeText(`ZIP-Archiv ${source.name}\n${listing}`);
    return {
      title: source.name.replace(/\.zip$/i, ""),
      documentType: "archive",
      language: languageOf(fulltext),
      metadata: { parser: "zip", entries: names, count: names.length },
      sections: [{ id: "zip-index", heading: "Archivinhalt", content: listing, hierarchy: 1 }],
      tables: [],
      entities: [],
      dates: [],
      references: names,
      fulltext,
      injectionSuspected: inspectUntrustedDocument(source.name, fulltext).injectionSuspected,
    };
  },
};

export const emailParser: KnowledgeParser = {
  id: "email",
  supports(source) {
    return source.sourceType === "email" || /\.(eml|mbox)$/i.test(source.name);
  },
  async parse(source) {
    const raw = source.bytes.toString("utf8");
    const headers: Record<string, string> = {};
    const [head, ...rest] = raw.split(/\n\n/);
    for (const line of (head ?? "").split(/\n/)) {
      const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (match) headers[match[1].toLowerCase()] = match[2];
    }
    const body = rest.join("\n\n");
    const fulltext = redactKnowledgeText([headers.subject, headers.from, headers.to, body].filter(Boolean).join("\n"));
    return {
      title: headers.subject || source.name,
      documentType: "email",
      language: languageOf(fulltext),
      metadata: { parser: "email", from: headers.from, to: headers.to, date: headers.date },
      sections: [{ id: "email-body", heading: headers.subject, content: fulltext, hierarchy: 1 }],
      tables: [],
      entities: [],
      dates: [],
      references: [],
      fulltext,
      injectionSuspected: inspectUntrustedDocument(source.name, fulltext).injectionSuspected,
    };
  },
};

export const chatgptParser: KnowledgeParser = {
  id: "chatgpt",
  supports(source) {
    if (source.sourceType === "chatgpt") return true;
    if (!/\.json$/i.test(source.name)) return false;
    const preview = source.bytes.subarray(0, 400).toString("utf8");
    return /"mapping"\s*:/.test(preview) || source.name.toLowerCase().includes("conversations");
  },
  async parse(source) {
    const raw = source.bytes.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
    const conversations = asRawConversations(parsed);
    const sections: ParsedSection[] = [];
    conversations.slice(0, 200).forEach((raw) => {
      const conversation = reconstructConversation(raw);
      if (!conversation) return;
      sections.push({
        id: conversation.externalId,
        heading: conversation.title,
        content: conversation.primaryPath.map((message) => `${message.role}: ${message.content}`).join("\n"),
        hierarchy: 1,
        metadata: {
          conversationId: conversation.externalId,
          messageCount: conversation.primaryPath.length,
          alternativeBranches: conversation.alternativeBranches.length,
          pipeline: "chatgpt-export",
        },
      });
    });
    const fulltext = redactKnowledgeText(sections.map((section) => `${section.heading}\n${section.content}`).join("\n\n"));
    return {
      title: "ChatGPT Export",
      documentType: "chat",
      language: languageOf(fulltext),
      metadata: {
        parser: "chatgpt",
        prepared: true,
        fullImport: true,
        conversationCount: sections.length,
        note: "Transcript → Conversation Archive, dauerhaftes Wissen → Knowledge/Memory.",
      },
      sections,
      tables: [],
      entities: [],
      dates: [],
      references: sections.map((section) => String(section.metadata?.conversationId ?? section.id)),
      fulltext,
      injectionSuspected: inspectUntrustedDocument(source.name, fulltext).injectionSuspected,
    };
  },
};

export function parseProjectSnapshot(input: {
  name: string;
  files: Array<{ path: string; content: string }>;
  git?: { repository?: string; branch?: string };
}): ParsedDocument {
  const readme = input.files.find((file) => /(^|\/)readme\.md$/i.test(file.path));
  const pkgFile = input.files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  let framework: string | undefined;
  let pkgName: string | undefined;
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      pkgName = pkg.name;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) framework = "Next.js";
      else if (deps.astro) framework = "Astro";
      else if (deps.react) framework = "React";
      else if (deps.vue) framework = "Vue";
    } catch {
      framework = undefined;
    }
  }
  const structure = input.files.map((file) => file.path).slice(0, 80).join("\n");
  const sections: ParsedSection[] = [];
  if (readme) {
    sections.push({ id: "readme", heading: "README", content: readme.content.slice(0, 8000), hierarchy: 1, metadata: { path: readme.path } });
  }
  if (pkgFile) {
    sections.push({
      id: "package",
      heading: "package.json",
      content: `name=${pkgName ?? ""}\nframework=${framework ?? "unbekannt"}`,
      hierarchy: 1,
      metadata: { path: pkgFile.path, framework },
    });
  }
  sections.push({ id: "structure", heading: "Projektstruktur", content: structure, hierarchy: 2 });
  for (const file of input.files) {
    if (/(^|\/)readme\.md$/i.test(file.path) || /(^|\/)package\.json$/i.test(file.path)) continue;
    if (/\.(md|txt|json)$/i.test(file.path) && !isSecretPath(file.path)) {
      sections.push({
        id: file.path,
        heading: file.path,
        content: file.content.slice(0, 4000),
        hierarchy: 3,
        metadata: { path: file.path },
      });
    }
  }
  const fulltext = redactKnowledgeText(sections.map((section) => section.content).join("\n\n"));
  return {
    title: pkgName || input.name,
    documentType: "project",
    language: languageOf(fulltext),
    metadata: {
      parser: "project-folder",
      framework,
      repository: input.git?.repository,
      branch: input.git?.branch,
      fileCount: input.files.length,
    },
    sections,
    tables: [],
    entities: [],
    dates: [],
    references: [],
    fulltext,
    injectionSuspected: inspectUntrustedDocument(input.name, fulltext).injectionSuspected,
  };
}

export const projectParser: KnowledgeParser = {
  id: "project",
  supports(source) {
    return source.sourceType === "folder" || source.sourceType === "repository";
  },
  async parse(source) {
    return parseProjectSnapshot({
      name: source.name,
      files: [{ path: source.name, content: source.bytes.toString("utf8").slice(0, 8000) }],
    });
  },
};
