import { create } from "zustand";

interface ChatComposerRequest {
  seed: string;
  focus: boolean;
  token: number;
}

interface ChatComposerState {
  pending: ChatComposerRequest | null;
  pushSeed: (seed: string) => void;
  requestFocus: () => void;
  consume: () => ChatComposerRequest | null;
}

let nextToken = 1;

export const useChatComposerStore = create<ChatComposerState>((set, get) => ({
  pending: null,
  pushSeed: (seed) =>
    set({
      pending: { seed, focus: true, token: nextToken++ },
    }),
  requestFocus: () =>
    set({
      pending: { seed: "", focus: true, token: nextToken++ },
    }),
  consume: () => {
    const current = get().pending;
    if (current) set({ pending: null });
    return current;
  },
}));
