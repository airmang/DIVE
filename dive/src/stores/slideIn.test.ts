import { beforeEach, describe, expect, it } from "vitest";
import { useSlideInStore } from "./slideIn";

describe("slideIn store runtime preview state", () => {
  beforeEach(() => {
    useSlideInStore.setState({
      isOpen: false,
      activeTab: "code",
      changedFiles: [],
      changeSummary: null,
      emptyReason: null,
      selectedFilePath: null,
      previewUrl: null,
      previewSession: null,
      previewRequestContext: null,
      runtimeEvidence: [],
      terminalLines: [],
    });
  });

  it("opens Preview with request context and session state", () => {
    useSlideInStore.getState().open({
      tab: "preview",
      previewRequestContext: { sessionId: 9, cardId: 4, source: "review_action" },
      previewSession: {
        requestId: "preview-1",
        status: "ready",
        previewUrl: "http://127.0.0.1:5173/",
        targetLabel: "http://127.0.0.1:5173/",
        commandSummary: null,
        errorReason: null,
        updatedAt: 100,
      },
    });

    const state = useSlideInStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeTab).toBe("preview");
    expect(state.previewRequestContext).toEqual({
      sessionId: 9,
      cardId: 4,
      source: "review_action",
    });
    expect(state.previewUrl).toBe("http://127.0.0.1:5173/");
  });

  it("keeps bounded startup logs in terminal state", () => {
    for (let i = 0; i < 1010; i += 1) {
      useSlideInStore.getState().pushTerminalLine({ kind: "stdout", text: `line ${i}` });
    }

    const lines = useSlideInStore.getState().terminalLines;
    expect(lines).toHaveLength(1000);
    expect(lines[0].text).toBe("line 10");
    expect(lines[999].text).toBe("line 1009");
  });
});
