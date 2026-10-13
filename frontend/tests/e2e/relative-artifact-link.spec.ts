import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

// A relative link in a message (`[report](报告.md)`) must open the thread's
// artifact. Left relative, the browser resolves it against the chat route as
// `/workspace/chats/报告.md`, and the chat page then requests a thread whose
// id is the file name.
const THREAD_ID = "00000000-0000-0000-0000-000000005101";
const REPORT_NAME = "报告.md";
const REPORT_PATH = `/mnt/user-data/outputs/${REPORT_NAME}`;
const CHART_PATH = "/mnt/user-data/outputs/chart.png";

// `delayHistory`: the thread state (and thus the artifact list) lands after the
// message has rendered. Streamdown memoizes its root without comparing
// `components`, so links and images must pick up the late list through context.
for (const delayHistory of [false, true]) {
  test(`relative link and image in a message resolve to thread artifacts (late artifact list: ${delayHistory})`, async ({
    page,
    context,
  }) => {
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: THREAD_ID,
          title: "Relative artifact link",
          artifacts: [REPORT_PATH, CHART_PATH],
          messages: [
            {
              type: "human",
              id: "msg-human-rel-link",
              content: [{ type: "text", text: "Write the report" }],
            },
            {
              type: "ai",
              id: "msg-ai-rel-link",
              content: `Done: [the report](${REPORT_NAME}). See also [a missing file](missing.md).\n\n![chart](chart.png)`,
            },
          ],
        },
      ],
    });
    if (delayHistory) {
      await page.route("**/api/langgraph/threads/*/history", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fallback();
      });
    }

    const artifactRequests: string[] = [];
    const chatNavigations: string[] = [];
    await context.route(
      (url) => url.pathname.includes(`/api/threads/${THREAD_ID}/artifacts/`),
      (route) => {
        artifactRequests.push(decodeURIComponent(route.request().url()));
        return route.fulfill({
          status: 200,
          contentType: "text/markdown; charset=utf-8",
          body: "# Report\n\nREPORT_BODY_MARKER",
        });
      },
    );
    context.on("request", (request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes(`/workspace/chats/${REPORT_NAME}`)) {
        chatNavigations.push(url);
      }
    });

    await page.goto(`/workspace/chats/${THREAD_ID}`);

    const reportLink = page.getByRole("link", { name: "the report" });
    await expect(reportLink).toBeVisible({ timeout: 30_000 });
    await expect(reportLink).toHaveAttribute("target", "_blank");
    expect(
      decodeURIComponent((await reportLink.getAttribute("href")) ?? ""),
    ).toContain(`/api/threads/${THREAD_ID}/artifacts${REPORT_PATH}`);

    await expect(page.getByRole("img", { name: "chart" })).toHaveAttribute(
      "src",
      new RegExp(`/api/threads/${THREAD_ID}/artifacts${CHART_PATH}$`),
    );

    // An unmatched relative link renders as text, not a navigable anchor.
    await expect(page.getByText("a missing file")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "a missing file" }),
    ).toHaveCount(0);

    const popupPromise = context.waitForEvent("page");
    await reportLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.locator("body")).toContainText("REPORT_BODY_MARKER");
    expect(decodeURIComponent(popup.url())).toContain(
      `/api/threads/${THREAD_ID}/artifacts${REPORT_PATH}`,
    );

    expect(artifactRequests.length).toBeGreaterThan(0);
    expect(chatNavigations).toEqual([]);
    await expect(page).toHaveURL(new RegExp(`/workspace/chats/${THREAD_ID}$`));
  });
}

// Message text rendered outside MessageListItem (the present_files message and
// clarification text) must resolve artifact links as well.
test("links in the present_files message text resolve to artifacts", async ({
  page,
}) => {
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: THREAD_ID,
        title: "Relative artifact link (present_files)",
        artifacts: [REPORT_PATH],
        messages: [
          {
            type: "human",
            id: "msg-human-rel-link-present",
            content: [{ type: "text", text: "Write the report" }],
          },
          {
            type: "ai",
            id: "msg-ai-rel-link-present",
            content: `Generated: [relative link](${REPORT_NAME}), [absolute link](${REPORT_PATH}).`,
            tool_calls: [
              {
                id: "present-rel-link",
                name: "present_files",
                args: { filepaths: [REPORT_PATH] },
              },
            ],
          },
        ],
      },
    ],
  });

  await page.goto(`/workspace/chats/${THREAD_ID}`);
  for (const name of ["relative link", "absolute link"]) {
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("target", "_blank");
    expect(
      decodeURIComponent((await link.getAttribute("href")) ?? ""),
    ).toContain(`/api/threads/${THREAD_ID}/artifacts${REPORT_PATH}`);
  }
});

// A reopened thread gets its values from the gateway's /history, which carries
// title / thread_data / messages but not `artifacts`. Links must still resolve
// from the present_files call in the messages (agent chat route).
test("reopened agent thread without state artifacts still resolves links", async ({
  page,
}) => {
  const files = [
    REPORT_PATH,
    "/mnt/user-data/outputs/notes.md",
    "/mnt/user-data/outputs/package.zip",
  ];
  mockLangGraphAPI(page, {
    agents: [{ name: "report-agent", display_name: "Report agent" }],
    threads: [
      {
        thread_id: THREAD_ID,
        title: "Reopened thread",
        agent_name: "report-agent",
        // No `artifacts`: mirrors the real /history payload.
        messages: [
          {
            type: "human",
            id: "msg-human-reopened",
            content: [{ type: "text", text: "Deliver the files" }],
          },
          {
            type: "ai",
            id: "msg-ai-reopened",
            run_id: "run-reopened",
            content: [
              "All three deliverables are ready.",
              "### Downloads",
              `- [Full report](./${REPORT_NAME})`,
              "- [Notes](./notes.md)",
              "- [Calculation package](./package.zip)",
            ].join("\n\n"),
            tool_calls: [
              {
                id: "present-reopened",
                name: "present_files",
                args: { filepaths: files },
              },
            ],
          },
          {
            type: "tool",
            id: "msg-tool-reopened",
            name: "present_files",
            tool_call_id: "present-reopened",
            content: "Successfully presented files",
          },
        ],
      },
    ],
  });

  await page.goto(`/workspace/agents/report-agent/chats/${THREAD_ID}`);
  for (const [name, path] of [
    ["Full report", files[0]],
    ["Notes", files[1]],
    ["Calculation package", files[2]],
  ] as const) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("target", "_blank");
    expect(decodeURIComponent((await link.getAttribute("href")) ?? "")).toBe(
      `/api/threads/${THREAD_ID}/artifacts${path}`,
    );
  }
  await expect(page.locator("span.decoration-dotted")).toHaveCount(0);
});
