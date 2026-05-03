import { SafeCard } from "./SafeCard";
import { WarnCard } from "./WarnCard";
import { DangerCard } from "./DangerCard";
import type { PermissionCardProps } from "./types";

export function PermissionCard(props: PermissionCardProps) {
  switch (props.card.risk) {
    case "safe":
      return <SafeCard {...props} />;
    case "warn":
      return <WarnCard {...props} />;
    case "danger":
      return <DangerCard {...props} />;
  }
}
