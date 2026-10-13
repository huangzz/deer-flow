import { describe, expect, it } from "@rstest/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageArtifactPathsContext } from "@/components/workspace/messages/artifact-paths-context";
import {
  createMarkdownLinkComponent,
  isSafeHref,
} from "@/components/workspace/messages/markdown-link";

describe("isSafeHref", () => {
  it("allows web URLs and same-origin paths", () => {
    expect(isSafeHref("https://example.com/path")).toBe(true);
    expect(isSafeHref("http://example.com/path")).toBe(true);
    expect(isSafeHref("/workspace/chats/1")).toBe(true);
    expect(isSafeHref("#section")).toBe(true);
  });

  it("allows scheme-less relative references", () => {
    expect(isSafeHref("report.md")).toBe(true);
    expect(isSafeHref("./report.md")).toBe(true);
    expect(isSafeHref("../assets/chart.png")).toBe(true);
  });

  it("allows non-executing contact schemes", () => {
    expect(isSafeHref("mailto:someone@example.com")).toBe(true);
    expect(isSafeHref("tel:+15551234567")).toBe(true);
  });

  it("rejects executable, local, and protocol-relative URLs", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("//example.com/path")).toBe(false);
    expect(isSafeHref("\\\\evil.com")).toBe(false);
    expect(isSafeHref(undefined)).toBe(false);
  });
});

// Render-level coverage: these tests exercise the component itself, so
// removing (or inverting) the isSafeHref guard inside MarkdownLink fails
// them even though isSafeHref stays untouched.
describe("MarkdownLink rendering", () => {
  const MarkdownLink = createMarkdownLinkComponent();

  it("renders an unsafe href as a disabled span, never an anchor", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownLink, { href: "javascript:alert(1)" }, "click me"),
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("<span");
    expect(html).toContain("click me");
    expect(html).not.toContain("href=");
    expect(html).toContain('aria-label="Unsafe link omitted"');
  });

  it("blocks unsafe hrefs before the citation branch", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownLink,
        { href: "javascript:alert(1)" },
        "citation:evil",
      ),
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
  });

  it("renders a safe https href as a hardened anchor", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownLink,
        { href: "https://example.com/report" },
        "report",
      ),
    );
    expect(html).toContain("<a");
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders citation labels when children are React element arrays", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownLink,
        { href: "https://example.com/report" },
        createElement("span", { key: "prefix" }, "citation:"),
        createElement("span", { key: "title" }, "Test Source"),
      ),
    );
    expect(html).not.toContain("citation:");
    expect(html).toContain("Test Source");
  });

  it("renders a scheme-less relative href as a navigable anchor", () => {
    const tests = ["report.md", "./report.md", "../assets/chart.png"];
    for (const href of tests) {
      const html = renderToStaticMarkup(
        createElement(MarkdownLink, { href }, "doc"),
      );
      expect(html).toContain("<a");
      expect(html).toContain(`href="${href}"`);
    }
  });
});

// Inside a thread message, a relative link must resolve to the thread's
// artifact. Left relative, the browser resolves it against the chat route
// (`/workspace/chats/<href>`) and the app treats the file name as a thread id.
describe("MarkdownLink relative artifact links (message context)", () => {
  const REPORT = "/mnt/user-data/outputs/报告.md";
  const artifacts = [
    REPORT,
    "/mnt/user-data/outputs/first/shared.md",
    "/mnt/user-data/outputs/second/shared.md",
    "/mnt/user-data/outputs/notes.md",
  ];
  const MessageLink = createMarkdownLinkComponent("thread-1");
  const reportURL =
    "/api/threads/thread-1/artifacts/mnt/user-data/outputs/" +
    encodeURIComponent("报告.md");

  function render(href: string, paths: readonly string[] | null = artifacts) {
    const link = createElement(MessageLink, { href }, "doc");
    return renderToStaticMarkup(
      paths === null
        ? link
        : createElement(
            MessageArtifactPathsContext.Provider,
            { value: paths },
            link,
          ),
    );
  }

  it("rewrites a uniquely matching relative link to the artifact URL", () => {
    // micromark percent-encodes non-ASCII hrefs before they reach the renderer.
    const html = render(encodeURI("报告.md"));
    expect(html).toContain(`href="${reportURL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // Same visible link styling as an ordinary markdown link.
    expect(html).toContain("text-primary");
    // The raw (unencoded) form resolves to the same artifact.
    expect(render("报告.md")).toContain(`href="${reportURL}"`);
  });

  it("strips leading ./ before matching", () => {
    expect(render("./报告.md")).toContain(`href="${reportURL}"`);
    expect(render("././outputs/notes.md")).toContain(
      'href="/api/threads/thread-1/artifacts/mnt/user-data/outputs/notes.md"',
    );
  });

  it("keeps ?query and #fragment suffixes on the rewritten URL", () => {
    expect(render("notes.md?v=2#part-1")).toContain(
      'href="/api/threads/thread-1/artifacts/mnt/user-data/outputs/notes.md?v=2#part-1"',
    );
  });

  it("never emits a relative href for ambiguous or unmatched links", () => {
    for (const href of ["shared.md", "missing.md", "./missing.md"]) {
      const html = render(href);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("href=");
      expect(html).toContain("<span");
      expect(html).toContain("doc");
    }
  });

  it("does not rewrite .. segments", () => {
    const html = render("../notes.md");
    expect(html).toContain('href="../notes.md"');
    expect(html).not.toContain("/api/threads/");
  });

  it("leaves external, anchor and absolute links untouched", () => {
    const external = render("https://example.com/notes.md");
    expect(external).toContain('href="https://example.com/notes.md"');
    expect(external).toContain('target="_blank"');
    expect(render("#notes.md")).toContain('href="#notes.md"');
    expect(render("mailto:a@example.com")).toContain(
      'href="mailto:a@example.com"',
    );
    expect(render("/workspace/chats/new")).toContain(
      'href="/workspace/chats/new"',
    );
  });

  it("rewrites /mnt/ links and styles them as links", () => {
    const html = render("/mnt/user-data/outputs/chart.png?v=2#detail");
    expect(html).toContain(
      'href="/api/threads/thread-1/artifacts/mnt/user-data/outputs/chart.png?v=2#detail"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain("text-primary");
  });

  it("leaves relative links alone when no artifact context is provided", () => {
    // Generic markdown outside a thread message (settings pages, etc.).
    expect(render("missing.md", null)).toContain('href="missing.md"');
  });
});
