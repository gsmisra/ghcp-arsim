import { WorkflowDefinition, WorkflowId } from '../types';
import { testCaseCreationWorkflow } from './testCaseCreation';
import { automationScriptCreationWorkflow } from './automationScriptCreation';
import { prAnalysisWorkflow } from './prAnalysis';
import { prodIncidentAnalysisWorkflow } from './prodIncidentAnalysis';
import { testFailureAnalysisWorkflow } from './testFailureAnalysis';

export const WORKFLOWS: WorkflowDefinition[] = [
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
