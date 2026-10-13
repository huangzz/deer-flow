import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, waitFor } from "@testing-library/react";

import { MessageArtifactPathsContext } from "@/components/workspace/messages/artifact-paths-context";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { useMessageMarkdownComponents } from "@/components/workspace/messages/message-markdown-components";

afterEach(cleanup);

const CONTENT = "See [the report](report.md).\n\n![chart](chart.png)";
const ARTIFACTS = [
  "/mnt/user-data/outputs/report.md",
  "/mnt/user-data/outputs/chart.png",
];

function MessageBody({ paths }: { paths: readonly string[] }) {
  const components = useMessageMarkdownComponents("thread-1");
  return (
    <MessageArtifactPathsContext.Provider value={paths}>
      <MarkdownContent
        content={CONTENT}
        isLoading={false}
        components={components}
      />
    </MessageArtifactPathsContext.Provider>
  );
}

describe("message artifact links and images (DOM)", () => {
  // The message can render before the thread state (and its artifact list)
  // has loaded. Streamdown memoizes its root without comparing `components`,
  // so the renderers must pick up the late list through context.
  it("re-resolves relative links and images when the artifact list arrives late", async () => {
    const { container, rerender } = render(<MessageBody paths={[]} />);

    await waitFor(() => {
      expect(container.textContent).toContain("the report");
    });
    // Before the list arrives: no relative href that would navigate the app.
    expect(container.querySelector('a[href="report.md"]')).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();

    rerender(<MessageBody paths={ARTIFACTS} />);

    await waitFor(() => {
      const link = Array.from(container.querySelectorAll("a")).find(
        (anchor) => anchor.textContent === "the report",
      );
      expect(link?.getAttribute("href")).toBe(
        "/api/threads/thread-1/artifacts/mnt/user-data/outputs/report.md",
      );
      expect(link?.getAttribute("target")).toBe("_blank");
    });
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "/api/threads/thread-1/artifacts/mnt/user-data/outputs/chart.png",
      );
    });
  });
});
