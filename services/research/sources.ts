import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { canonicalizeUrl, domainOf } from "@/lib/research/url";
import type { FetchedPage, RankedSearchResult, TrustTier } from "@/lib/research/types";

export type PersistSourceInput = {
  organizationId: string;
  jobId?: string;
  url: string;
  canonicalUrl?: string;
  title?: string;
  domain?: string;
  publishedAt?: string | null;
  retrievedAt?: string | Date | null;
  provider?: string;
  excerpt?: string;
  trustTier?: TrustTier;
  trustScore?: number;
  metadata?: Record<string, unknown>;
};

export async function persistResearchSource(input: PersistSourceInput) {
  assertOrganizationId(input.organizationId);
  const url = canonicalizeUrl(input.url);
  const canonicalUrl = canonicalizeUrl(input.canonicalUrl || url);
  const existing = await prisma.source.findFirst({
    where: {
      organizationId: input.organizationId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      OR: [{ url }, { canonicalUrl }],
    },
  });
  const data = {
    type: "research",
    reference: input.jobId ?? null,
    url,
    canonicalUrl,
    title: input.title?.slice(0, 300) ?? null,
    domain: input.domain || domainOf(canonicalUrl),
    publishedAt: input.publishedAt && !Number.isNaN(Date.parse(input.publishedAt)) ? new Date(input.publishedAt) : null,
    retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : new Date(),
    provider: input.provider ?? null,
    excerpt: input.excerpt?.slice(0, 1200) ?? null,
    trustTier: input.trustTier ?? null,
    trustScore: input.trustScore ?? null,
    label: input.title?.slice(0, 180) ?? domainOf(canonicalUrl),
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    jobId: input.jobId ?? null,
  };

  if (existing) {
    return prisma.source.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.source.create({
    data: {
      organizationId: input.organizationId,
      ...data,
    },
  });
}

export async function persistFetchedSources(input: {
  organizationId: string;
  jobId?: string;
  pages: FetchedPage[];
  ranked: RankedSearchResult[];
}) {
  const byUrl = new Map(input.ranked.map((item) => [item.canonicalUrl, item]));
  const saved = [];
  for (const page of input.pages) {
    const ranked = byUrl.get(page.canonicalUrl) ?? input.ranked.find((item) => item.url === page.url);
    saved.push(
      await persistResearchSource({
        organizationId: input.organizationId,
        jobId: input.jobId,
        url: page.url,
        canonicalUrl: page.canonicalUrl,
        title: page.title,
        domain: page.domain,
        publishedAt: page.publishedAt,
        retrievedAt: page.retrievedAt,
        provider: ranked?.provider ?? "http-fetch",
        excerpt: page.excerpt,
        trustTier: ranked?.trustTier,
        trustScore: ranked?.trustScore,
        metadata: {
          method: page.method,
          status: page.status ?? null,
          injectionSuspected: page.injectionSuspected,
          headings: page.headings.slice(0, 8),
        },
      }),
    );
  }
  return saved;
}
