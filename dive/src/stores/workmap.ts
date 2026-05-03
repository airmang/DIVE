import { create } from "zustand";
import type { CardState, CardTileData } from "../components/workmap/types";

export type DiveStage = "d" | "i" | "v" | "e";

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
  setCards: (cards: CardTileData[]) => void;
  addCard: (card: CardTileData) => void;
  addCards: (cards: CardTileData[]) => void;
  updateCard: (id: number, patch: Partial<CardTileData>) => void;
  setCurrentCard: (id: number | null) => void;
  transitionCard: (id: number, nextState: CardState) => void;
  setInstruction: (id: number, instruction: string) => void;
  clear: () => void;
}

function stagesForState(state: CardState): CardTileData["stagesCompleted"] {
  switch (state) {
    case "decomposed":
      return { d: true, i: false, v: false, e: false };
    case "instructed":
      return { d: true, i: true, v: false, e: false };
    case "verifying":
      return { d: true, i: true, v: false, e: false };
    case "verified":
      return { d: true, i: true, v: true, e: false };
    case "rejected":
      return { d: true, i: true, v: false, e: false };
    case "extended":
      return { d: true, i: true, v: true, e: true };
  }
}

export const useWorkmapStore = create<WorkmapState>((set) => ({
  cards: [],
  currentCardId: null,
  setCards: (cards) => set({ cards }),
  addCard: (card) => set((s) => ({ cards: [...s.cards, card] })),
  addCards: (cards) => set((s) => ({ cards: [...s.cards, ...cards] })),
  updateCard: (id, patch) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  setCurrentCard: (id) => set({ currentCardId: id }),
  transitionCard: (id, nextState) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id ? { ...c, state: nextState, stagesCompleted: stagesForState(nextState) } : c,
      ),
    })),
  setInstruction: (id, instruction) =>
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
          stagesCompleted: stagesForState(nextState),
        };
      }),
    })),
  clear: () => set({ cards: [], currentCardId: null }),
}));

export const selectCanChat = (state: WorkmapState): boolean => state.cards.length > 0;

export const selectAllCardsVerified = (state: WorkmapState): boolean =>
  state.cards.length > 0 &&
  state.cards.every((c) => c.state === "verified" || c.state === "extended");

export const selectCurrentCard = (state: WorkmapState): CardTileData | null => {
  if (state.currentCardId === null) return null;
  return state.cards.find((c) => c.id === state.currentCardId) ?? null;
};

export function inferStageFor(
  currentCard: CardTileData | null,
  cardCount: number,
  allVerified: boolean,
): DiveStage {
  if (cardCount === 0) return "d";
  if (currentCard) {
    if (currentCard.state === "verifying") return "v";
    if (currentCard.state === "verified" || currentCard.state === "extended") {
      return allVerified ? "e" : "d";
    }
    return "i";
  }
  return allVerified ? "e" : "d";
}
