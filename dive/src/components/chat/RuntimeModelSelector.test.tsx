// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { RuntimeModelSelector } from "./RuntimeModelSelector";

describe("RuntimeModelSelector", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [
        {
          id: 1,
          kind: "openai",
          auth_type: "api_key",
          base_url: null,
          is_connected: true,
          is_active: false,
          selected_model: "gpt-5.4",
        },
        {
          id: 2,
          kind: "openrouter",
          auth_type: "api_key",
          base_url: null,
          is_connected: true,
          is_active: true,
          selected_model: "openai/gpt-5.4-mini",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ loaded: false, providers: [] });
  });

  it("surfaces the active provider and its model in chat", async () => {
    render(<RuntimeModelSelector />);

    expect(screen.getByTestId("chat-provider-select")).toHaveProperty("value", "2");
    await waitFor(() => {
      expect(screen.getByTestId("chat-model-select")).toHaveProperty(
        "value",
        "openai/gpt-5.4-mini",
      );
    });
  });
});
