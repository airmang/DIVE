import { useMemo } from "react";
import { generateProvocationCards } from "./rules";
import type { ProvocationCard, ProvocationContext } from "./types";

export function useProvocationCards(context: ProvocationContext | null): ProvocationCard[] {
  return useMemo(() => (context ? generateProvocationCards(context) : []), [context]);
}
