import { getBackendBaseURL } from "../config";
import { isStaticWebsiteOnly } from "../static-mode";
import type { AgentThreadState } from "../threads";

const EMPTY_ARTIFACT_PATHS: readonly string[] = [];

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function splitPathSuffix(src: string) {
  const [path = ""] = src.split(/[?#]/, 1);
  return {
    path,
    suffix: src.slice(path.length),
  };
}

function encodeArtifactPath(filepath: string) {
  // This is a filesystem path, not a URL: a literal "%20" must stay part
  // of the filename after the server decodes the request path once.
  return filepath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildWriteFileArtifactURL({
  filepath,
  messageId,
  toolCallId,
}: {
  filepath: string;
  messageId?: string;
  toolCallId?: string;
}) {
  const url = new URL("write-file:/");
  url.pathname = filepath.replaceAll("%", "%25");
  if (messageId) {
    url.searchParams.set("message_id", messageId);
  }
  if (toolCallId) {
    url.searchParams.set("tool_call_id", toolCallId);
  }
  return url.toString();
}

function decodeRelativeArtifactPath(filepath: string) {
  return filepath.split("/").map(decodePathSegment).join("/");
}

export function urlOfArtifact({
  filepath,
  threadId,
  download = false,
  isMock = false,
}: {
  filepath: string;
  threadId: string;
  download?: boolean;
  isMock?: boolean;
}) {
  if (isStaticWebsiteOnly()) {
    return staticDemoArtifactURL({ filepath, threadId, download });
  }
  const encodedThreadId = encodeURIComponent(threadId);
  const encodedFilepath = encodeArtifactPath(filepath);
  if (isMock) {
    return `${getBackendBaseURL()}/mock/api/threads/${encodedThreadId}/artifacts${encodedFilepath}${download ? "?download=true" : ""}`;
  }
  return `${getBackendBaseURL()}/api/threads/${encodedThreadId}/artifacts${encodedFilepath}${download ? "?download=true" : ""}`;
}

export function urlOfArtifactArchive({
  threadId,
  runId,
}: {
  threadId: string;
  runId: string;
}) {
  return `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/artifacts/archive`;
}

export function extractArtifactsFromThread(thread: {
  values: Pick<AgentThreadState, "artifacts">;
}) {
  return thread.values.artifacts ?? EMPTY_ARTIFACT_PATHS;
}

export function resolveArtifactURL(absolutePath: string, threadId: string) {
  if (isStaticWebsiteOnly()) {
    return staticDemoArtifactURL({ filepath: absolutePath, threadId });
  }
  return `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/artifacts${encodeArtifactPath(absolutePath)}`;
}

export function resolveMarkdownArtifactURL(src: string, threadId: string) {
  const { path, suffix } = splitPathSuffix(src);
  // Markdown destinations already carry URL escapes; decode only at this
  // boundary before handing the raw path to the artifact URL builder.
  return `${resolveArtifactURL(decodeRelativeArtifactPath(path), threadId)}${suffix}`;
}

function parseRelativeArtifactReference(src: string) {
  const { path: relativePath, suffix } = splitPathSuffix(src);
  const normalizedPath = relativePath.replace(/^(?:\.\/)+/, "");
  if (
    !normalizedPath ||
    normalizedPath.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(normalizedPath) ||
    normalizedPath.startsWith("//") ||
    normalizedPath.split("/").includes("..")
  ) {
    return null;
  }
  return { decodedPath: decodeRelativeArtifactPath(normalizedPath), suffix };
}

/**
 * True for a scheme-less relative reference (`report.md`, `./out/a.png`)
 * that could name a thread artifact: no scheme, no leading `/`, no `..`
 * segment, and a non-empty path (so `#anchor` / `?q` are excluded).
 */
export function isRelativeArtifactReference(src: string) {
  return parseRelativeArtifactReference(src) !== null;
}

/**
 * Resolves a relative reference to this thread's artifact URL when its path
 * suffix-matches exactly one artifact. Returns `null` when `src` is not a
 * relative reference or when zero / several artifacts match.
 */
export function resolveRelativeArtifactURL(
  src: string,
  threadId: string,
  artifactPaths: readonly string[],
): string | null {
  const ref = parseRelativeArtifactReference(src);
  if (!ref) {
    return null;
  }

  const matches = artifactPaths.filter((path) =>
    path.endsWith(`/${ref.decodedPath}`),
  );
  if (matches.length !== 1) {
    return null;
  }

  return `${resolveArtifactURL(matches[0]!, threadId)}${ref.suffix}`;
}

export function resolveMessageImageURL(
  src: string,
  threadId: string,
  artifactPaths: readonly string[],
) {
  if (src.startsWith("/mnt/")) {
    return resolveMarkdownArtifactURL(src, threadId);
  }

  return resolveRelativeArtifactURL(src, threadId, artifactPaths) ?? src;
}

function staticDemoArtifactURL({
  filepath,
  threadId,
  download = false,
}: {
  filepath: string;
  threadId: string;
  download?: boolean;
}) {
  const demoPath = encodeArtifactPath(filepath.replace(/^\/mnt\//, "/"));
  return `${getBackendBaseURL()}/demo/threads/${encodeURIComponent(threadId)}${demoPath}${download ? "?download=true" : ""}`;
}
