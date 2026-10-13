import {
  useContext,
  type AnchorHTMLAttributes,
  type ComponentProps,
} from "react";

import {
  isRelativeArtifactReference,
  resolveMarkdownArtifactURL,
  resolveRelativeArtifactURL,
} from "@/core/artifacts/utils";
import { knowledgeSourceId } from "@/core/knowledge/sources";
import { cn } from "@/lib/utils";

import { CitationLink, extractReactNodeText } from "../citations/citation-link";

import { MessageArtifactPathsContext } from "./artifact-paths-context";

/**
 * Schemes we are willing to render as a navigable ``<a href=...>``.
 *
 * Anything else (``javascript:``, ``data:text/html``, ``vbscript:``,
 * ``file:``, …) is blocked because once it lands in a real anchor the
 * browser happily executes the payload in the chat surface where
 * sessionStorage / CSRF cookies are reachable. We accept ``http(s)``
 * plus the non-executing ``mailto:`` / ``tel:`` schemes; same-origin
 * absolute paths (``/…``), scheme-less relative references (``report.md``,
 * ``./…``, ``../…``), and in-document anchors (``#…``) are also allowed
 * — they all resolve under the current HTTP(S) origin.
 */
const SAFE_HREF_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"] as const;

export function isSafeHref(href: string | undefined): boolean {
  if (typeof href !== "string" || href.length === 0) {
    return false;
  }
  // Same-document anchors (e.g. "#section").
  if (href.startsWith("#")) {
    return true;
  }
  // Protocol-relative URLs (//evil.com/path) would inherit the current
  // page's scheme and navigate to an unknown host. Also reject
  // backslash-normalised variants (\\evil.com → //evil.com) because
  // browsers treat backslash as a path separator in URLs.
  if (/^(\/\/|\\\\)/.test(href)) {
    return false;
  }
  // Parse the href so we can inspect its scheme. Items without an explicit
  // protocol (report.md, ./report.md, ../assets/chart.png, /workspace/foo)
  // resolve relative to the dummy HTTPS base, producing an https: URL.
  // Explicitly-schemed URLs (https://…, mailto:, javascript:, data:, …)
  // keep their native scheme, which we then check against the allowlist.
  try {
    const parsed = new URL(href, "https://dummy.example/");
    return (SAFE_HREF_PROTOCOLS as ReadonlyArray<string>).includes(
      parsed.protocol,
    );
  } catch {
    return false;
  }
}

/**
 * Inert stand-in for a link whose href failed `isSafeHref`. It keeps the
 * visible label and marks the omission on hover and for assistive tech, so
 * every surface that applies the allowlist degrades the same way. Extra props
 * pass through for wrappers such as Radix `asChild` triggers.
 */
export function UnsafeLink({
  href,
  className,
  ...props
}: ComponentProps<"span"> & { href: string }) {
  return (
    <span
      {...props}
      className={cn(
        "text-muted-foreground cursor-not-allowed underline decoration-dotted underline-offset-2",
        className,
      )}
      aria-label="Unsafe link omitted"
      title={`Unsafe link scheme in ${href}`}
    />
  );
}

function isExternalUrl(href: string | undefined): boolean {
  if (typeof href !== "string") {
    return false;
  }
  return /^https?:\/\//.test(href);
}

/**
 * Builds the `a` renderer shared by message content and generic markdown.
 * Passing a `threadId` also resolves `/mnt/` artifact links; without it those
 * links fall through to the default external-link handling.
 *
 * Inside a `MessageArtifactPathsContext` provider, scheme-less relative links
 * (`report.md`, `./out/report.md`) are resolved against the thread's
 * artifacts with the same unique-suffix rule as message images. Left as-is,
 * the browser would resolve them against the chat route
 * (`/workspace/chats/report.md`) and navigate the app to a non-existent
 * thread.
 */
export function createMarkdownLinkComponent(threadId?: string) {
  return function MarkdownLink({
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) {
    const artifactPaths = useContext(MessageArtifactPathsContext);
    // Reject unsafe schemes up front so a prompt-injected / pasted href can
    // never reach the rendered anchor — including through the citation
    // branch (which renders <a href={href}> directly). Check before the
    // citation block so prompt-injected [citation:x](javascript:...) is
    // blocked. Keep the visible label so the user can still see what the
    // link claimed to point at.
    if (href !== undefined && !isSafeHref(href)) {
      // Intentionally no {...props} spread: react-markdown props like `node`
      // (and anchor-only attributes such as target/rel) are not valid on a
      // <span> and would trigger React DOM warnings.
      const { className, children } = props;
      return (
        <UnsafeLink href={href} className={className}>
          {children}
        </UnsafeLink>
      );
    }
    // Knowledge destinations also appear as ordinary [Title](URL) Sources links.
    if (knowledgeSourceId(href)) {
      return <CitationLink {...props} href={href} />;
    }
    // Safe-href check passed — citation links now route through CitationLink.
    const childrenText = extractReactNodeText(props.children);
    if (childrenText !== null) {
      const match = /^citation:(.+)$/.exec(childrenText);
      if (match) {
        const [, text] = match;
        return (
          <CitationLink {...props} href={href}>
            {text}
          </CitationLink>
        );
      }
    }
    // Artifact links (`/mnt/...` and relative references to a thread
    // artifact) open the artifact in a new tab and keep the regular link
    // styling so they read as clickable.
    let resolvedHref = href;
    let opensInNewTab = isExternalUrl(href);
    if (threadId && href?.startsWith("/mnt/")) {
      resolvedHref = resolveMarkdownArtifactURL(href, threadId);
      opensInNewTab = true;
    } else if (
      threadId &&
      artifactPaths &&
      href &&
      isRelativeArtifactReference(href)
    ) {
      const artifactURL = resolveRelativeArtifactURL(
        href,
        threadId,
        artifactPaths,
      );
      if (!artifactURL) {
        // No unique artifact matches (none yet, or several). Render the label
        // as inert text: a relative href here would navigate the app to
        // `/workspace/chats/<href>`.
        const { className, children } = props;
        return (
          <span
            className={cn(
              "text-muted-foreground underline decoration-dotted underline-offset-2",
              className,
            )}
            title={`No artifact in this conversation matches ${href}`}
          >
            {children}
          </span>
        );
      }
      resolvedHref = artifactURL;
      opensInNewTab = true;
    }
    const { className, target, rel, ...rest } = props;
    return (
      <a
        {...rest}
        href={resolvedHref}
        className={cn(
          "text-primary decoration-primary/30 hover:decoration-primary/60 underline underline-offset-2 transition-colors",
          className,
        )}
        target={target ?? (opensInNewTab ? "_blank" : undefined)}
        rel={rel ?? (opensInNewTab ? "noopener noreferrer" : undefined)}
      />
    );
  };
}
