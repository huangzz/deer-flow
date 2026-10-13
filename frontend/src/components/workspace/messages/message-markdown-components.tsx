import { useContext, useMemo, type ImgHTMLAttributes } from "react";

import {
  isRelativeArtifactReference,
  resolveMessageImageURL,
} from "@/core/artifacts/utils";
import { cn } from "@/lib/utils";

import { MessageArtifactPathsContext } from "./artifact-paths-context";
import { createMarkdownLinkComponent } from "./markdown-link";

/**
 * Markdown renderers for thread message text: `/mnt/` and relative artifact
 * references in links and images resolve to this thread's artifacts. Render
 * the markdown inside a `MessageArtifactPathsContext` provider carrying the
 * thread's artifact paths.
 */
export function useMessageMarkdownComponents(threadId: string) {
  return useMemo(
    () => ({
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <MessageImage {...props} threadId={threadId} maxWidth="90%" />
      ),
      a: createMarkdownLinkComponent(threadId),
    }),
    [threadId],
  );
}

/**
 * Custom image component that handles artifact URLs. The thread's artifact
 * paths come from `MessageArtifactPathsContext` (see there for why).
 */
function MessageImage({
  src,
  alt,
  threadId,
  maxWidth = "90%",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  threadId: string;
  maxWidth?: string;
}) {
  const artifactPaths = useContext(MessageArtifactPathsContext);
  if (!src) return null;

  // `maxWidth` is applied inline rather than through a `max-w-[${maxWidth}]`
  // class: Tailwind's JIT only generates utilities it can find as literal
  // source tokens, so an interpolated arbitrary value would never be emitted.
  const imgClassName = cn("overflow-hidden rounded-lg", props.className);
  const imgStyle: React.CSSProperties = { maxWidth, ...props.style };

  if (typeof src !== "string") {
    return (
      <img
        {...props}
        className={imgClassName}
        style={imgStyle}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const url = resolveMessageImageURL(src, threadId, artifactPaths ?? []);
  const image = (
    <img
      {...props}
      className={imgClassName}
      style={imgStyle}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );

  // An unresolved relative reference would link to the chat route
  // (`/workspace/chats/<src>`); show the image without a link instead.
  if (url === src && isRelativeArtifactReference(src)) {
    return image;
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {image}
    </a>
  );
}
