import OpenAI from "openai";
import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";
import { RESEARCH_LIMITS } from "@/lib/research/limits";
import { canonicalizeUrl, domainOf } from "@/lib/research/url";
import { bucheVerbrauch } from "@/lib/kosten";
import type { SearchProvider, SearchQuery, SearchResponse, SearchResult } from "@/types/connectors";

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" ? (value as LooseRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countryCode(input?: string): string {
  const raw = (input ?? "DE").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : "DE";
}

function freshnessHint(input: SearchQuery): string {
  if (input.freshness === "day") return " Prefer results from the last 24 hours.";
  if (input.freshness === "week") return " Prefer results from the last 7 days.";
  if (input.freshness === "month") return " Prefer results from the last 30 days.";
  return "";
}

function collectResults(output: unknown[]): SearchResult[] {
  const collected: SearchResult[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string, snippet: string, extra?: Record<string, unknown>) => {
    const canonical = canonicalizeUrl(url);
    if (!/^https?:\/\//i.test(canonical) || seen.has(canonical)) return;
    seen.add(canonical);
    collected.push({
      title: title || domainOf(canonical) || canonical,
      url: canonical,
      snippet: snippet.slice(0, 500),
      publishedAt: typeof extra?.publishedAt === "string" ? extra.publishedAt : null,
      source: domainOf(canonical),
      rank: collected.length + 1,
      provider: "openai-web-search",
      metadata: extra,
    });
  };

  for (const item of output) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type === "web_search_call") {
      for (const result of asArray(record.results)) {
        const row = asRecord(result);
        if (!row) continue;
        push(textOf(row.title), textOf(row.url), textOf(row.snippet ?? row.text), {
          from: "results",
          publishedAt: textOf(row.published_at || row.publishedAt) || null,
        });
      }
      const action = asRecord(record.action);
      for (const source of asArray(action?.sources)) {
        const row = asRecord(source);
        if (!row) continue;
        push(textOf(row.title), textOf(row.url), "", { from: "sources" });
      }
    }
    for (const block of asArray(record.content)) {
      const content = asRecord(block);
      for (const annotation of asArray(content?.annotations)) {
        const row = asRecord(annotation);
        if (!row || row.type !== "url_citation") continue;
        push(textOf(row.title), textOf(row.url), "", { from: "citation" });
      }
    }
  }
  return collected;
}

export class OpenAISearchProvider implements SearchProvider {
  id = "openai-web-search";
  mock = false;

  async search(input: SearchQuery): Promise<SearchResponse> {
    const query = input.query.trim().slice(0, RESEARCH_LIMITS.maxQueryLength);
    if (!query) return { mock: false, results: [], error: "empty_query", queries: [] };
    if (!hasOpenAIApiKey()) {
      return { mock: false, results: [], error: "missing_openai_key", queries: [query] };
    }

    const tool: LooseRecord = {
      type: "web_search",
      user_location: {
        type: "approximate",
        country: countryCode(input.country),
      },
    };
    if (input.domains?.length) {
      tool.filters = { allowed_domains: input.domains.slice(0, 20) };
    } else if (input.excludeDomains?.length) {
      tool.filters = { blocked_domains: input.excludeDomains.slice(0, 20) };
    }

    const prompt = [
      "Perform a web search and return relevant sources.",
      `Language preference: ${input.language ?? "de"}.`,
      `Query: ${query}`,
      freshnessHint(input),
      "Do not invent URLs. Search the live web.",
    ].join(" ");

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: "gpt-4o-mini",
        tools: [tool as never],
        include: ["web_search_call.action.sources", "web_search_call.results"],
        tool_choice: { type: "web_search" } as never,
        input: prompt,
      });
      const output = asArray((response as { output?: unknown[] }).output);
      const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      bucheVerbrauch({ art: "websuche", modell: "gpt-4o-mini", eingabeTokens: usage?.input_tokens, ausgabeTokens: usage?.output_tokens });
      // Die Suchaufrufe selbst kosten extra; ihr Preis steht nicht in der Tabelle (Modell „web_search“ in ~/Nova/preise.json).
      bucheVerbrauch({ art: "websuche", modell: "web_search", anfragen: output.filter((item) => asRecord(item)?.type === "web_search_call").length });
      const results = collectResults(output).slice(0, input.limit ?? RESEARCH_LIMITS.maxResultsPerQuery);
      return {
        mock: false,
        results,
        queries: [query],
        error: results.length === 0 ? "no_results" : undefined,
      };
    } catch (error) {
      return {
        mock: false,
        results: [],
        queries: [query],
        error: publicErrorMessage(error),
      };
    }
  }
}
