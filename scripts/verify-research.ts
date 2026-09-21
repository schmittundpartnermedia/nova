import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runResearchUnitTests } from "@/lib/research/unit-tests";
import { OpenAISearchProvider } from "@/connectors/search/openai";
import { MockSearchProvider } from "@/connectors/search/mock";
import { fetchHttpPage, isFetchedPage } from "@/lib/research/fetch";
import { ResearchPlaywrightFetcher } from "@/lib/research/playwright";
import { runResearchWorkflow } from "@/agents/research/workflow";
import { runMaster } from "@/agents/master";
import { applyPlaywrightBrowsersPath } from "@/lib/computer/config";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { bootstrapAgents } from "@/agents/bootstrap";

const prisma = new PrismaClient();

function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.join(process.cwd(), "scripts/fixtures");
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const relative = requestUrl.pathname.replace(/^\/+/, "");
    const full = path.resolve(root, relative);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const type = full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
    res.writeHead(200, { "Content-Type": type });
    res.end(fs.readFileSync(full));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture-Server ohne Port."));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.on("error", reject);
  });
}

async function main() {
  bootstrapAgents();
  applyPlaywrightBrowsersPath();
  const unitFailures = runResearchUnitTests();
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) throw new Error("Seed fehlt.");

  const mock = new MockSearchProvider();
  const mockSearch = await mock.search({ organizationId: organization.id, query: "should not invent" });

  const search = new OpenAISearchProvider();
  const germanSearch = await search.search({
    organizationId: organization.id,
    query: "aktueller Bundeskanzler Deutschland offizielle Seite",
    language: "de",
    country: "DE",
    freshness: "week",
    limit: 8,
  });
  const englishSearch = await search.search({
    organizationId: organization.id,
    query: "current WHO Director-General official biography",
    language: "en",
    country: "US",
    freshness: "month",
    limit: 8,
  });

  const job = await prisma.job.create({
    data: {
      organizationId: organization.id,
      userRequest: "Wer ist derzeit Bundeskanzler von Deutschland?",
      goal: "Aktuelle Amtsinhaberin/Amtsinhaber mit offizieller Quelle prüfen",
      status: "running",
    },
  });
  const germanResearch = await runResearchWorkflow({
    context: {
      organizationId: organization.id,
      jobId: job.id,
      userRequest: "Wer ist derzeit Bundeskanzler von Deutschland?",
      goal: "Aktuelle Amtsinhaberin/Amtsinhaber mit offizieller Quelle prüfen",
    },
    query: "Wer ist derzeit Bundeskanzler von Deutschland?",
    persistCompanies: false,
  });

  const enJob = await prisma.job.create({
    data: {
      organizationId: organization.id,
      userRequest: "Who is the current Director-General of the WHO?",
      goal: "Identify current WHO Director-General from official sources",
      status: "running",
    },
  });
  const englishResearch = await runResearchWorkflow({
    context: {
      organizationId: organization.id,
      jobId: enJob.id,
      userRequest: "Who is the current Director-General of the WHO?",
      goal: "Identify current WHO Director-General from official sources",
    },
    query: "Who is the current Director-General of the WHO?",
    persistCompanies: false,
  });

  const fixture = await startFixtureServer();
  const playwright = new ResearchPlaywrightFetcher();
  let injectPage = null;
  let httpJs = null;
  let playwrightJs = null;
  try {
    injectPage = await fetchHttpPage(`${fixture.url}/browser/inject.html`, { allowLocal: true });
    httpJs = await fetchHttpPage(`${fixture.url}/research/js-only.html`, { allowLocal: true });
    playwrightJs = await playwright.fetch(`${fixture.url}/research/js-only.html`, true);
  } finally {
    await playwright.close();
    await fixture.close();
  }

  const memoryBefore = await prisma.memoryEntry.count({ where: { organizationId: organization.id } });
  const master = await runMaster({
    organizationId: organization.id,
    userRequest: "Wer ist derzeit Bundeskanzler von Deutschland?",
  });
  const memoryAfter = await prisma.memoryEntry.count({ where: { organizationId: organization.id } });
  const storedSources = await prisma.source.findMany({
    where: { organizationId: organization.id, jobId: job.id, type: "research" },
  });
  const archive = await prisma.activity.findFirst({
    where: { organizationId: organization.id, jobId: master.jobId, type: "research" },
  });

  const germanDomains = new Set(germanResearch.fetched.map((page) => page.domain));
  const englishDomains = new Set(englishResearch.fetched.map((page) => page.domain));
  const officialHit = germanResearch.fetched.some((page) => /bundesregierung\.de|bundeskanzler\.de|bundestag\.de/i.test(page.canonicalUrl));
  const injectOk = isFetchedPage(injectPage) && injectPage.injectionSuspected;
  const httpMissesJs = isFetchedPage(httpJs) && !/NovaResearchJsMarker/i.test(httpJs.text);
  const playwrightHitsJs = isFetchedPage(playwrightJs) && /NovaResearchJsMarker/i.test(playwrightJs.text);
  const injectNotExecuted = !/uploaded|ssh-key|settings geändert|rm -rf/i.test(germanResearch.answer + master.reply);

  const checks = {
    unitTests: unitFailures.length === 0,
    openaiKey: hasOpenAIApiKey(),
    mockDoesNotInvent: mockSearch.mock === true && mockSearch.results.length === 0,
    germanSearchLive: germanSearch.mock === false && germanSearch.results.some((item) => /^https?:\/\//i.test(item.url)),
    englishSearchLive: englishSearch.mock === false && englishSearch.results.some((item) => /^https?:\/\//i.test(item.url)),
    multipleQueries: germanResearch.queries.length >= 2,
    germanAnswerFromSources: germanResearch.ok && germanResearch.sourceIds.length >= 1 && germanResearch.answer.length > 0,
    officialSourcePrioritized: officialHit,
    threeSources: germanResearch.fetched.length >= 3 || englishResearch.fetched.length >= 3 || germanDomains.size >= 3,
    freshnessTracked: germanResearch.fetched.some((page) => Boolean(page.retrievedAt)) && germanResearch.knowledgeKind === "current",
    germanResearch: /kanzler|merz|deutschland/i.test(germanResearch.answer),
    internationalResearch: englishResearch.ok && englishDomains.size >= 1,
    promptInjectionFlagged: injectOk,
    promptInjectionNotExecuted: injectNotExecuted,
    playwrightFallback: httpMissesJs && playwrightHitsJs,
    sourcesPersisted: storedSources.length >= 1 && storedSources.every((item) => Boolean(item.url)),
    memoryNotDumpingResults: germanResearch.memoryCandidates.length < Math.max(2, germanResearch.results.length),
    archiveRecorded: Boolean(archive),
    masterLive: /kanzler|merz|nicht zuverlässig/i.test(master.reply) && master.providerMode !== "error",
    memoryDidNotExplode: memoryAfter - memoryBefore <= germanResearch.memoryCandidates.length + 3,
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const report = {
    checks,
    failed,
    unitFailures,
    german: {
      queries: germanResearch.queries,
      sources: germanResearch.fetched.map((page) => page.canonicalUrl),
      answer: germanResearch.answer.slice(0, 280),
      asOf: germanResearch.asOf,
    },
    english: {
      queries: englishResearch.queries,
      sources: englishResearch.fetched.map((page) => page.canonicalUrl),
      answer: englishResearch.answer.slice(0, 280),
    },
    masterReply: master.reply.slice(0, 280),
    memoryDelta: memoryAfter - memoryBefore,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    throw new Error(`Research-Verifikation fehlgeschlagen: ${failed.join(", ")}`);
  }
  console.log("NOVA Research-Verifikation erfolgreich.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
