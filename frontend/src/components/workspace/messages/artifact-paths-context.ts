import { createContext } from "react";

/**
 * Artifact paths of the thread whose message text is being rendered.
 *
 * Message markdown renderers (`a`, `img`) read the list from context rather
 * than closing over it: Streamdown memoizes its root without comparing the
 * `components` prop, so a renderer built from the list keeps the list it saw
 * on the first render and never picks up artifacts that arrive later (e.g.
 * when the message renders before the thread state has loaded). A context
 * change propagates through that memo.
 *
 * `null` (no provider) means "not inside a thread message": relative links are
 * left untouched, as in settings pages or other generic markdown.
 */
export const MessageArtifactPathsContext = createContext<
  readonly string[] | null
>(null);
