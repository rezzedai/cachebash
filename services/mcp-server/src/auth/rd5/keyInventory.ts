/**
 * RD-5 PR-D: key-inventory logic. Read-only: this module never writes.
 * The CLI is scripts/rd5/key-inventory.ts.
 */

/** Minimal read surface of a Firestore document snapshot. */
export interface DocLike {
  id: string;
  data(): Record<string, unknown> | undefined;
}

export interface InventoryDb {
  collection(name: string): { get(): Promise<{ docs: DocLike[] }> };
}

export type CapabilityState =
  | { kind: "list"; values: string[] }
  | { kind: "missing" }
  | { kind: "not-array"; rawType: string };

export interface InventoryRow {
  hashPrefix: string;
  programId: string;
  tenant: string;
  active: string;
  expiresAt: string;
  rotatedTo: boolean;
  capabilities: CapabilityState;
}

/** Capabilities exactly as stored. A missing or non-array field is its own state, never `[]`. */
export function readCapabilities(data: Record<string, unknown>): CapabilityState {
  if (!("capabilities" in data) || data.capabilities === undefined || data.capabilities === null) {
    return { kind: "missing" };
  }
  if (!Array.isArray(data.capabilities)) {
    return { kind: "not-array", rawType: typeof data.capabilities };
  }
  return { kind: "list", values: data.capabilities.map(String) };
}

/** Renders a Firestore Timestamp, Date, string or number as ISO text; "none" when absent. */
export function formatTime(v: unknown): string {
  if (v === undefined || v === null) return "none";
  const anyV = v as { toDate?: () => Date };
  const d = typeof anyV.toDate === "function" ? anyV.toDate() : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? `unparseable:${String(v)}` : d.toISOString();
}

export function inventoryRow(id: string, data: Record<string, unknown>): InventoryRow {
  return {
    hashPrefix: id.slice(0, 8),
    programId: String(data.programId ?? "(none)"),
    tenant: String(data.userId ?? "(none)"),
    active: data.active === undefined ? "absent(treated active)" : String(data.active),
    expiresAt: formatTime(data.expiresAt),
    rotatedTo: data.rotatedTo !== undefined && data.rotatedTo !== null,
    capabilities: readCapabilities(data),
  };
}

export function formatCapabilities(c: CapabilityState): string {
  switch (c.kind) {
    case "list":
      return JSON.stringify(c.values);
    case "missing":
      return "!! MISSING (code reads as [\"*\"])";
    case "not-array":
      return `!! NOT-AN-ARRAY:${c.rawType} (code reads as non-list)`;
  }
}

export function formatRow(r: InventoryRow): string {
  return [
    r.hashPrefix,
    `program=${r.programId}`,
    `tenant=${r.tenant}`,
    `active=${r.active}`,
    `expiresAt=${r.expiresAt}`,
    `rotatedTo=${r.rotatedTo ? "present" : "absent"}`,
    `capabilities=${formatCapabilities(r.capabilities)}`,
  ].join("  ");
}

export async function runKeyInventory(db: InventoryDb): Promise<string[]> {
  const snap = await db.collection("keyIndex").get();
  return snap.docs
    .map((d) => inventoryRow(d.id, d.data() ?? {}))
    .sort((a, b) => a.programId.localeCompare(b.programId) || a.hashPrefix.localeCompare(b.hashPrefix))
    .map(formatRow);
}
