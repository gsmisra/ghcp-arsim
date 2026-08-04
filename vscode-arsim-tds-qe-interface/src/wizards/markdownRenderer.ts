import { GithubFileKind } from '../types';

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function computeFileName(kind: GithubFileKind, data: Record<string, string>): string {
  const slug = slugify(data.name || 'untitled');
  switch (kind) {
    case 'skill':
      return `${slug}.md`;
    case 'instruction':
      return `${slug}.instructions.md`;
    case 'prompt':
      return `${slug}.prompt.md`;
  }
}

function section(title: string, value: string | undefined): string {
  const body = (value || '').trim();
  if (!body) return '';
  return `## ${title}\n\n${body}\n`;
}

function frontmatter(pairs: Record<string, string | undefined>): string {
  const lines = Object.entries(pairs)
    .filter(([, v]) => (v ?? '').trim().length > 0)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

export function renderSkillMarkdown(data: Record<string, string>): string {
  const fm = frontmatter({
    name: data.name,
    description: data.description,
    owner: data.owner,
    version: data.version || '1.0.0',
    scope: data.scope,
  });

  const body = [
    `# ${data.name || 'Untitled Skill'}`,
    '',
    section('Description', data.description),
    section('When To Use', data.whenToUse),
    section('Applicable Scope', data.scope),
    section('Procedure', data.procedure),
    section('Required Tools / Permissions', data.toolsRequired),
    section('Inputs', data.inputs),
    section('Outputs', data.outputs),
    section('Example Input', data.exampleInput ? '```\n' + data.exampleInput + '\n```' : ''),
    section('Example Output', data.exampleOutput ? '```\n' + data.exampleOutput + '\n```' : ''),
    section('Edge Cases & Constraints', data.edgeCases),
    section('Anti-Patterns / Do NOT', data.antiPatterns),
    section('Related Skills / Instructions / Links', data.relatedLinks),
    section('Review Notes', data.reviewNotes),
  ]
    .filter(Boolean)
    .join('\n');

  return `${fm}\n${body}\n`;
}

export function renderInstructionMarkdown(data: Record<string, string>): string {
  const fm = frontmatter({
    applyTo: data.applyTo,
    description: data.description,
    owner: data.owner,
    version: data.version || '1.0.0',
  });

  const body = [
    `# ${data.name || 'Untitled Instruction Set'}`,
    '',
    section('Description', data.description),
    section('Scope & Context', data.scopeContext),
    section('Coding Standards & Conventions', data.codingStandards),
    section('Required Patterns / Architecture Rules', data.requiredPatterns),
    section("Do's", data.dos),
    section("Don'ts", data.donts),
    section('Security & Compliance Requirements', data.securityCompliance),
    section('Testing Expectations', data.testingExpectations),
    section('Example (Good)', data.goodExample ? '```\n' + data.goodExample + '\n```' : ''),
    section('Example (Bad)', data.badExample ? '```\n' + data.badExample + '\n```' : ''),
    section('References / Links', data.references),
  ]
    .filter(Boolean)
    .join('\n');

  return `${fm}\n${body}\n`;
}

export function renderPromptMarkdown(data: Record<string, string>): string {
  const fm = frontmatter({
    mode: data.mode || 'ask',
    description: data.description,
    model: data.targetModel,
    owner: data.owner,
    version: data.version || '1.0.0',
  });

  const body = [
    `# ${data.name || 'Untitled Prompt'}`,
    '',
    section('Description', data.description),
    section('Required Variables / Inputs', data.variables),
    section('Prompt Body', data.body),
    section('Expected Output Format', data.outputFormat),
    section('Constraints / Guardrails', data.constraints),
    section('Example Usage', data.exampleUsage),
  ]
    .filter(Boolean)
    .join('\n');

  return `${fm}\n${body}\n`;
}

export function renderMarkdown(kind: GithubFileKind, data: Record<string, string>): string {
  switch (kind) {
    case 'skill':
      return renderSkillMarkdown(data);
    case 'instruction':
      return renderInstructionMarkdown(data);
    case 'prompt':
      return renderPromptMarkdown(data);
  }
}
