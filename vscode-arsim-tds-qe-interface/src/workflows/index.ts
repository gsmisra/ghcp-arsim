import { WorkflowDefinition, WorkflowId } from '../types';
import { genericWorkflow } from './generic';
import { testCaseCreationWorkflow } from './testCaseCreation';
import { automationScriptCreationWorkflow } from './automationScriptCreation';
import { prAnalysisWorkflow } from './prAnalysis';
import { prodIncidentAnalysisWorkflow } from './prodIncidentAnalysis';
import { testFailureAnalysisWorkflow } from './testFailureAnalysis';

// `genericWorkflow` ("-- Select --") is listed first so it renders as the
// dropdown's default option without any special-casing in the webview.
export const WORKFLOWS: WorkflowDefinition[] = [
  genericWorkflow,
  testCaseCreationWorkflow,
  automationScriptCreationWorkflow,
  prAnalysisWorkflow,
  prodIncidentAnalysisWorkflow,
  testFailureAnalysisWorkflow,
];

const BY_ID: Record<WorkflowId, WorkflowDefinition> = WORKFLOWS.reduce(
  (acc, w) => ({ ...acc, [w.id]: w }),
  {} as Record<WorkflowId, WorkflowDefinition>
);

export function getWorkflow(id: WorkflowId): WorkflowDefinition {
  const workflow = BY_ID[id];
  if (!workflow) {
    throw new Error(`Unknown workflow id: ${id}`);
  }
  return workflow;
}
