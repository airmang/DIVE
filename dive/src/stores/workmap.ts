import { create } from "zustand";
import type { CardState, CardTileData } from "../components/workmap/types";
import type { PromptContext } from "../lib/prompt-templates";

export type CardTransitionKind =
  | "enter_instruct"
  | "request_verify"
  | "approve"
  | "reject"
  | "reopen_from_reject"
  | "extend";

interface WorkmapState {
  cards: CardTileData[];
  currentCardId: number | null;
  hydrateFromRemote: (cards: CardTileData[], currentCardId: number | null) => void;
  setCardsLocal: (cards: CardTileData[]) => void;
  addCardLocal: (card: CardTileData) => void;
  addCardsLocal: (cards: CardTileData[]) => void;
  updateCardLocal: (id: number, patch: Partial<CardTileData>) => void;
  setCurrentCardLocal: (id: number | null) => void;
  transitionCardLocal: (id: number, nextState: CardState) => void;
  setInstructionLocal: (id: number, instruction: string) => void;
  clearLocal: () => void;
}

export const useWorkmapStore = create<WorkmapState>((set) => ({
  cards: [],
  currentCardId: null,
  hydrateFromRemote: (cards, currentCardId) => set({ cards, currentCardId }),
  setCardsLocal: (cards) => set({ cards }),
  addCardLocal: (card) => set((s) => ({ cards: [...s.cards, card] })),
  addCardsLocal: (cards) => set((s) => ({ cards: [...s.cards, ...cards] })),
  updateCardLocal: (id, patch) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  setCurrentCardLocal: (id) => set({ currentCardId: id }),
  transitionCardLocal: (id, nextState) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, state: nextState } : c)),
    })),
  setInstructionLocal: (id, instruction) =>
    set((s) => ({
      cards: s.cards.map((c) => {
        if (c.id !== id) return c;
        const trimmed = instruction.trim();
        const nextState: CardState =
          trimmed.length > 0 && c.state === "decomposed" ? "instructed" : c.state;
        const summary = trimmed.length > 0 ? trimmed.slice(0, 80) : c.summary;
        return {
          ...c,
          summary,
          state: nextState,
        };
      }),
    })),
  clearLocal: () => set({ cards: [], currentCardId: null }),
}));

export const selectCanChat = (state: WorkmapState): boolean => state.cards.length > 0;

export const selectAllCardsVerified = (state: WorkmapState): boolean =>
  state.cards.length > 0 &&
  state.cards.every((c) => c.state === "verified" || c.state === "extended");

export const selectCurrentCard = (state: WorkmapState): CardTileData | null => {
  if (state.currentCardId === null) return null;
  return state.cards.find((c) => c.id === state.currentCardId) ?? null;
};

export function promptContextFor(
  currentCard: CardTileData | null,
  cardCount: number,
  allVerified: boolean,
): PromptContext {
  if (cardCount === 0) return "plan";
  if (currentCard) {
    switch (currentCard.state) {
      case "decomposed":
        return "plan";
      case "verifying":
      case "verified":
      case "extended":
        return "verify";
      case "instructed":
      case "rejected":
        return "build";
    }
  }
  return allVerified ? "verify" : "plan";
}
