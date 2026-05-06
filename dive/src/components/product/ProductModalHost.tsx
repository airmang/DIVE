import { NewProjectDialog } from "../onboarding/NewProjectDialog";
import { OnboardingDialog } from "../onboarding/OnboardingDialog";
import type { ProductShellController } from "./useProductShellController";

interface ProductModalHostProps {
  modals: ProductShellController["modals"];
}

export function ProductModalHost({ modals }: ProductModalHostProps) {
  return (
    <>
      <OnboardingDialog {...modals.onboarding} />
      <NewProjectDialog {...modals.newProject} />
    </>
  );
}
