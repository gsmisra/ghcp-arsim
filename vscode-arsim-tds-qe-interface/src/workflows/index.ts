import { WorkflowDefinition, WorkflowId } from '../types';
import { genericWorkflow } from './generic';
import { prAnalysisWorkflow } from './prAnalysis';
import { prodIncidentAnalysisWorkflow } from './prodIncidentAnalysis';
import { generateFeatureFileFromJiraStoryWorkflow } from './generateFeatureFileFromJiraStory';

// `genericWorkflow` ("-- Select --") is listed first so it renders as the
// dropdown's default option without any special-casing in the webview.
// Test Case Creation, Automation Script Creation, and Test Failure
// Analysis are currently disabled (see testCaseCreation.ts /
// automationScriptCreation.ts / testFailureAnalysis.ts) and intentionally
// left out of this list.
export const WORKFLOWS: WorkflowDefinition[] = [
  genericWorkflow,
  prAnalysisWorkflow,
  prodIncidentAnalysisWorkflow,
  generateFeatureFileFromJiraStoryWorkflow,
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
