import { useMemo, useState } from "react";
import type { CardTileData } from "../workmap/types";

export function useProductShellDialogs() {
  const [aiOpen, setAiOpen] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retroCard, setRetroCard] = useState<CardTileData | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [planInterviewOpen, setPlanInterviewOpen] = useState(false);
  const [planReviewOpen, setPlanReviewOpen] = useState(false);

  return useMemo(
    () => ({
      aiOpen,
      setAiOpen,
      newCardOpen,
      setNewCardOpen,
      detailOpen,
      setDetailOpen,
      retroCard,
      setRetroCard,
      onboardingOpen,
      setOnboardingOpen,
      newProjectOpen,
      setNewProjectOpen,
      planInterviewOpen,
      setPlanInterviewOpen,
      planReviewOpen,
      setPlanReviewOpen,
    }),
    [
      aiOpen,
      detailOpen,
      newCardOpen,
      newProjectOpen,
      onboardingOpen,
      planInterviewOpen,
      planReviewOpen,
      retroCard,
    ],
  );
}
