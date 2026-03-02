/**
 * Programs Domain Registry — Program registry management tools.
 */
import { AuthContext } from "../auth/authValidator.js";
import { listProgramsHandler, updateProgramHandler } from "../modules/programRegistry.js";

type Handler = (auth: AuthContext, args: any) => Promise<any>;

export const handlers: Record<string, Handler> = {
  list_programs: listProgramsHandler,
  update_program: updateProgramHandler,
};

export const definitions = [
  {
    name: "list_programs",
    description: "List all registered programs for the tenant. Filterable by role, group, active status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        role: { type: "string", maxLength: 100, description: "Filter by role" },
        group: { type: "string", maxLength: 100, description: "Filter by group membership" },
        active: { type: "boolean", default: true, description: "Filter by active status" },
      },
    },
  },
  {
    name: "update_program",
    description: "Update a program's metadata. Programs can update their own entry; admin can update any.",
    inputSchema: {
      type: "object" as const,
      properties: {
        programId: { type: "string", maxLength: 100, description: "Program ID to update" },
        displayName: { type: "string", maxLength: 200, description: "Human-readable display name" },
        role: { type: "string", maxLength: 100, description: "Functional role (builder, orchestrator, etc.)" },
        color: { type: "string", maxLength: 20, description: "Hex color for portal display" },
        groups: { type: "array", items: { type: "string", maxLength: 100 }, description: "Multicast groups" },
        tags: { type: "array", items: { type: "string", maxLength: 100 }, description: "Freeform tags" },
      },
      required: ["programId"],
    },
  },
];
