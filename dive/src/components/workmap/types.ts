/**
 * Workmap card tile types. `CardState` must stay in sync with the Rust enum
 * in DIVE_SPEC.md §10.3 (serde rename_all = "lowercase"). Changing a variant
 * here without updating `src-tauri/src/db/models.rs` breaks IPC round-trips.
 */

export type CardState =
  | "decomposed"
  | "instructed"
  | "verifying"
  | "verified"
  | "rejected"
  | "extended";

export type CardTileMode = "expanded" | "collapsed";

export interface CardDiveStages {
  d: boolean;
  i: boolean;
  v: boolean;
  e: boolean;
}

export interface CardTileData {
  id: number;
  title: string;
  summary: string | null;
  assistSummary?: string | null;
  acceptanceCriteria?: string | null;
  retrospective?: string | null;
  changeSummary?: string | null;
  testCommand?: string | null;
  state: CardState;
  stagesCompleted: CardDiveStages;
  position: number;
}

export interface CardTileProps {
  card: CardTileData;
  mode: CardTileMode;
  onClick?: (card: CardTileData) => void;
  disabled?: boolean;
}

export interface WorkmapCardListProps {
  cards: CardTileData[];
  mode: CardTileMode;
  canAddCard?: boolean;
  onAddCard?: () => void;
  onCardClick?: (card: CardTileData) => void;
}

export interface VerifyLogView {
  intent_match: boolean;
  test_result: "pass" | "fail" | "skipped";
  details: string;
  model: string;
  ran_at: number;
  test_command?: string | null;
  test_exit_code?: number | null;
  test_stdout?: string | null;
  test_stderr?: string | null;
}
