import { useMemo, useState } from "react";

export function useProductShellDialogs() {
  const [stepDetailOpen, setStepDetailOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  return useMemo(
    () => ({
      stepDetailOpen,
      setStepDetailOpen,
      onboardingOpen,
      setOnboardingOpen,
      newProjectOpen,
      setNewProjectOpen,
      recoveryOpen,
      setRecoveryOpen,
    }),
    [stepDetailOpen, newProjectOpen, onboardingOpen, recoveryOpen],
  );
}
