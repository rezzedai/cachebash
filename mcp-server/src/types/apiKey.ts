/**
 * API Key types for per-program identity.
 */

import { Timestamp } from "firebase-admin/firestore";
import { ValidProgramId } from "../config/programs.js";

/** Firestore document at keyIndex/{sha256(key)} */
export interface ApiKeyDoc {
  userId: string;
  programId: ValidProgramId;
  label: string;
  capabilities: string[];   // Phase 2: ["*"]. Phase 4: scoped.
  createdAt: Timestamp;
  lastUsedAt?: Timestamp;
  revokedAt?: Timestamp;
  active: boolean;
}
