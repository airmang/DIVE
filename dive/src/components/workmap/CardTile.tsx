import { CardTileCollapsed } from "./CardTileCollapsed";
import { CardTileExpanded } from "./CardTileExpanded";
import type { CardTileProps } from "./types";

export function CardTile({ card, mode, onClick, disabled }: CardTileProps) {
  if (mode === "collapsed") {
    return <CardTileCollapsed card={card} disabled={disabled} onClick={onClick} />;
  }
  return <CardTileExpanded card={card} disabled={disabled} onClick={onClick} />;
}

export default CardTile;
