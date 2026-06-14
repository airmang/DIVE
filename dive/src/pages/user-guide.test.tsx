// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UserGuidePage } from "./user-guide";

describe("UserGuidePage", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("renders the bundled user guide index", () => {
    window.history.replaceState({}, "", "/?route=user-guide");

    render(<UserGuidePage />);

    expect(screen.getByTestId("user-guide-page")).toBeTruthy();
    expect(screen.getByText("DIVE 사용자 가이드")).toBeTruthy();
    expect(screen.getByText(/처음 DIVE를 접하는 학습자/)).toBeTruthy();
  });

  it("renders troubleshooting for the issue menu route", () => {
    window.history.replaceState({}, "", "/?route=user-guide&doc=troubleshooting");

    render(<UserGuidePage />);

    expect(screen.getByText("DIVE 트러블슈팅")).toBeTruthy();
    expect(screen.getByText(/WebView2 런타임 설치 실패/)).toBeTruthy();
  });
});
