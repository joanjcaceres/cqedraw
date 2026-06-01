import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(webRoot, "public");

function readWebFile(path: string): string {
  return readFileSync(resolve(webRoot, path), "utf8");
}

function readPublicFile(path: string): string {
  return readFileSync(resolve(publicRoot, path), "utf8");
}

describe("crawl metadata", () => {
  it("declares the HTTPS custom domain as canonical", () => {
    const indexHtml = readWebFile("index.html");

    expect(indexHtml).toContain('<link rel="canonical" href="https://cqedraw.org/" />');
    expect(indexHtml).toContain('<meta property="og:url" content="https://cqedraw.org/" />');
    expect(indexHtml).not.toContain("http://cqedraw.org");
  });

  it("exposes brand-search metadata before the app hydrates", () => {
    const indexHtml = readWebFile("index.html");

    expect(indexHtml).toContain('<meta name="application-name" content="cQEDraw" />');
    expect(indexHtml).toContain('"name": "cQEDraw"');
    expect(indexHtml).toContain('"alternateName": ["CQEDraw", "cQEDraw web editor"]');
    expect(indexHtml).toContain('"codeRepository": "https://github.com/joanjcaceres/cqedraw"');
    expect(indexHtml).toContain("<h1>cQEDraw</h1>");
    expect(indexHtml).toContain("browser-based superconducting circuit graph editor");
  });

  it("points crawlers only at the HTTPS sitemap URL", () => {
    const robotsTxt = readPublicFile("robots.txt");
    const sitemapXml = readPublicFile("sitemap.xml");

    expect(robotsTxt).toContain("Sitemap: https://cqedraw.org/sitemap.xml");
    expect(robotsTxt).not.toContain("http://cqedraw.org");
    expect(sitemapXml).toContain("<loc>https://cqedraw.org/</loc>");
    expect(sitemapXml).not.toContain("http://cqedraw.org");
  });

  it("ships the GitHub Pages custom domain with the deploy artifact", () => {
    expect(readPublicFile("CNAME").trim()).toBe("cqedraw.org");
  });
});
