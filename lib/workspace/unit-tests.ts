import assert from "node:assert/strict";
import { artifactFileName, localDay, slugify } from "@/lib/workspace/naming";
import { directoryForArtifact } from "@/lib/workspace/layout";
import { classifyWorkspaceProbe } from "@/lib/workspace/root";

export function runWorkspaceUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  check("slug", () => {
    assert.equal(slugify("Sponsoren Recherche"), "sponsoren-recherche");
    assert.equal(slugify("Größe"), "groesse");
  });

  check("filename", () => {
    const name = artifactFileName({
      date: new Date(2026, 8, 25, 12, 0, 0),
      organizationSlug: "rankPilot",
      title: "Sponsoren Recherche",
      version: 1,
      extension: "md",
    });
    assert.equal(name, "2026-09-25_rankpilot_sponsoren-recherche_v01.md");
    assert.equal(localDay(new Date(2026, 8, 25)), "2026-09-25");
    assert.doesNotMatch(name, /final2|wirklich/);
  });

  check("layout creates only the needed directory", () => {
    assert.equal(
      directoryForArtifact({ type: "RESEARCH_REPORT", organizationSlug: "joachim", projectSlug: "Website" }),
      "Projekte/joachim/website",
    );
    assert.equal(directoryForArtifact({ type: "LEAD_LIST", organizationSlug: "elevum" }), "Leads/elevum");
    assert.equal(directoryForArtifact({ type: "VIDEO_CLIP", organizationSlug: "elevum" }), "Medien/Video/elevum");
  });

  check("unavailable is not success", () => {
    const status = classifyWorkspaceProbe({
      configured: true,
      resolvedPath: "/Volumes/ELEVUM",
      volumeName: "ELEVUM",
      source: "env",
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
    });
    assert.equal(status.availability, "UNAVAILABLE");
    assert.equal(status.writable, false);
    assert.match(status.message, /nichts/);
  });

  check("read only", () => {
    const status = classifyWorkspaceProbe({
      configured: false,
      resolvedPath: "/Volumes/ELEVUM",
      volumeName: "ELEVUM",
      source: "volume",
      exists: true,
      isDirectory: true,
      readable: true,
      writable: false,
    });
    assert.equal(status.availability, "READ_ONLY");
  });

  check("available", () => {
    const status = classifyWorkspaceProbe({
      configured: false,
      resolvedPath: "/Volumes/ELEVUM",
      volumeName: "ELEVUM",
      source: "volume",
      exists: true,
      isDirectory: true,
      readable: true,
      writable: true,
    });
    assert.equal(status.availability, "AVAILABLE");
    assert.equal(status.writable, true);
  });

  return failures;
}
