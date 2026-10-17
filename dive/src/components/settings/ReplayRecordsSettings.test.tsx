// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { ReplayRecordsSettings, type ReplaySettings } from "./ReplayRecordsSettings";

const invoke = vi.hoisted(() => vi.fn());
const tauriAvailable = vi.hoisted(() => ({ value: true }));

vi.mock("../../lib/tauri", () => ({
  loadTauri: async () =>
    tauriAvailable.value ? { invoke, convertFileSrc: (p: string) => p } : null,
}));

function backend(initial: ReplaySettings) {
  let state = { ...initial };
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "replay_settings_set") {
      state = { ...state, captureEnabled: Boolean(args?.captureEnabled) };
    } else if (command === "replay_records_clear") {
      state = { ...state, recordCount: 0 };
    } else if (command !== "replay_settings_get") {
      throw new Error(`unexpected ${command}`);
    }
    return state;
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ReplayRecordsSettings (spec 015 FR-021)", () => {
  beforeEach(() => {
    invoke.mockReset();
    tauriAvailable.value = true;
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows capture state and record count, and toggles capture", async () => {
    backend({ captureEnabled: true, recordCount: 12 });
    render(<ReplayRecordsSettings />);
    await flush();

    const toggle = (await screen.findByTestId(
      "settings-replay-capture-toggle",
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByTestId("settings-replay-count").textContent).toBe("저장된 기록 12개");

    fireEvent.click(toggle);
    await flush();
    expect(invoke).toHaveBeenCalledWith("replay_settings_set", { captureEnabled: false });
    expect((screen.getByTestId("settings-replay-capture-toggle") as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("clears records only after confirmation", async () => {
    backend({ captureEnabled: true, recordCount: 3 });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<ReplayRecordsSettings />);
    await flush();

    fireEvent.click(await screen.findByTestId("settings-replay-clear"));
    await flush();
    expect(invoke).not.toHaveBeenCalledWith("replay_records_clear", undefined);

    fireEvent.click(screen.getByTestId("settings-replay-clear"));
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("replay_records_clear", undefined);
    expect(screen.getByTestId("settings-replay-count").textContent).toBe("저장된 기록 0개");
    expect((screen.getByTestId("settings-replay-clear") as HTMLButtonElement).disabled).toBe(true);
  });

  it("is hidden outside the desktop app", async () => {
    tauriAvailable.value = false;
    render(<ReplayRecordsSettings />);
    await flush();
    expect(screen.queryByTestId("settings-replay")).toBeNull();
  });
});
