import { WorkflowDefinition } from '../types';

/**
 * The default, unopinionated entry in the "Workflow to perform" dropdown.
 * Rendered as "-- Select --" so the extension never forces a user into one
 * of the five canned QE workflows: in this mode they can still pick Skills,
 * Instructions, and a Custom Prompt and send an arbitrary request straight
 * to the selected model, with only a light, safe framing system prompt
 * rather than a workflow-specific output contract.
 */
export const genericWorkflow: WorkflowDefinition = {
  id: 'generic',
  label: '-- Select --',
  description:
    'No specific workflow. Send a general-purpose request -- optionally combined with selected Skills, Instructions, or a Custom Prompt.',
  inputPlaceholder: 'Type any request for Copilot. Select Skills/Instructions/a Custom Prompt below to add context...',
  systemPrompt: `SYSTEM ROLE:
You are an enterprise Copilot assistant embedded in VS Code for a banking software delivery organization.

OBJECTIVE:
Respond directly and helpfully to the user's request below. No fixed output format is imposed by this mode.

GUIDANCE:
- Treat any Skill or Instruction content provided below as binding context/conventions for this response.
- If the request is ambiguous or missing information needed to answer well, ask a clarifying question instead of guessing.
- Do not fabricate facts about the user's codebase, systems, or data beyond what is provided in the context below.`,
};
