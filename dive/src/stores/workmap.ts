import { create } from "zustand";
import type { CardTileData } from "../components/workmap/types";

interface WorkmapState {
  cards: CardTileData[];
  setCards: (cards: CardTileData[]) => void;
  addCard: (card: CardTileData) => void;
  addCards: (cards: CardTileData[]) => void;
  updateCard: (id: number, patch: Partial<CardTileData>) => void;
  clear: () => void;
}

export const useWorkmapStore = create<WorkmapState>((set) => ({
  cards: [],
  setCards: (cards) => set({ cards }),
  addCard: (card) => set((s) => ({ cards: [...s.cards, card] })),
  addCards: (cards) => set((s) => ({ cards: [...s.cards, ...cards] })),
  updateCard: (id, patch) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  clear: () => set({ cards: [] }),
}));

export const selectCanChat = (state: WorkmapState): boolean => state.cards.length > 0;
