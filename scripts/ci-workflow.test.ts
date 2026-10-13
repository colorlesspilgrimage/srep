import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: the CI workflow file must stay safe for pull requests.
// Actions use a full commit SHA. Test steps do not see CI tokens.
// Failure reports expire after one day. Temp files stay out of /tmp.

const workflow = readFileSync(
  path.resolve(import.meta.dirname, '../.github/workflows/ci.yml'),
  'utf8',
);

const REPO_RUNS = new Set([
  'npm ci',
  'npm run lint',
  'npm run check',
  'npm run test',
  'npm run test:e2e',
  'npx playwright install --with-deps chromium',
]);

const BLANK_TOKEN_LINES = [
  "GITHUB_TOKEN: ''",
  "GH_TOKEN: ''",
  "DOCKERHUB_USERNAME: ''",
  "DOCKERHUB_TOKEN: ''",
];

function jobText(name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing_job:${name}`);
  }
  const rest = workflow.slice(start + 1);
  const next = rest.slice(marker.length - 1).search(/\n {2}[a-z0-9-]+:\n/);
  if (next < 0) {
    return rest;
  }
  return rest.slice(0, next + marker.length - 1);
}

function actionUses(text: string): string[] {
  return [...text.matchAll(/uses: (\S+)/g)].map((match) => match[1] ?? '');
}

function runLine(line: string): RegExpExecArray | null {
  return /^ +(?:- )?run: (.*)$/.exec(line);
}

function runScripts(text: string): string[] {
  const lines = text.split('\n');
  const scripts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = runLine(lines[index] ?? '');
    if (match === null) {
      continue;
    }
    const command = match[1] ?? '';
    if (command === '|') {
      scripts.push(scriptBody(lines, index));
      continue;
    }
    scripts.push(command);
  }
  return scripts;
}

function owningDashIndent(lines: string[], runIndex: number): number {
  const runLine = lines[runIndex] ?? '';
  if (runLine.trimStart().startsWith('- ')) {
    return runLine.search(/\S/);
  }
  for (let index = runIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (line.trimStart().startsWith('- ')) {
      return line.search(/\S/);
    }
  }
  return runLine.search(/\S/);
}

function linesUntilNextStep(lines: string[], start: number, dashIndent: number): string {
  const body: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      body.push(line);
      continue;
    }
    if (line.search(/\S/) <= dashIndent) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

function scriptBody(lines: string[], runIndex: number): string {
  const indent = (lines[runIndex] ?? '').search(/\S/);
  return linesUntilNextStep(lines, runIndex + 1, indent);
}

function repoRunBlocks(text: string): { run: string; following: string }[] {
  const lines = text.split('\n');
  const blocks: { run: string; following: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const inline = runLine(lines[index] ?? '');
    if (inline === null) {
      continue;
    }
    const run = inline[1] ?? '';
    if (run === '|') {
      continue;
    }
    if (!REPO_RUNS.has(run)) {
      continue;
    }
    blocks.push({
      run,
      following: linesUntilNextStep(lines, index + 1, owningDashIndent(lines, index)),
    });
  }
  return blocks;
}

describe('ci workflow safety', () => {
  it('pins every action to a full commit SHA', () => {
    const uses = actionUses(workflow);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
    }
  });

  it('does not check out pull request secrets with a writable token', () => {
    const checkouts = actionUses(workflow).filter((action) =>
      action.startsWith('actions/checkout@'),
    );
    expect(checkouts).toHaveLength(4);
    expect(workflow.match(/persist-credentials: false/g) ?? []).toHaveLength(checkouts.length);
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toContain('github.event');
    expect(workflow).toContain('permissions:\n  contents: read\n');
    expect(workflow).not.toMatch(/\bcontents: write\b/);
    expect(workflow).not.toMatch(/\bactions: write\b/);
    expect(workflow).not.toMatch(/\bid-token:/);
    expect(workflow).not.toMatch(/\bpull-requests:/);
  });

  it('keeps repository commands away from CI tokens', () => {
    const blocks = repoRunBlocks(workflow);
    expect(blocks.map((block) => block.run).sort()).toEqual(
      [
        'npm ci',
        'npm ci',
        'npm ci',
        'npm run check',
        'npm run lint',
        'npm run test',
        'npm run test',
        'npm run test:e2e',
        'npm run test:e2e',
        'npx playwright install --with-deps chromium',
        'npx playwright install --with-deps chromium',
      ].sort(),
    );
    for (const block of blocks) {
      for (const line of BLANK_TOKEN_LINES) {
        expect(block.following, block.run).toContain(line);
      }
    }
  });

  it('drops Docker Hub credentials before repository commands', () => {
    for (const name of ['e2e-postgres', 'docker']) {
      const text = jobText(name);
      const removeAt = text.indexOf('rm -f "$HOME/.docker/config.json"');
      const commandAt =
        text.indexOf('npm ci') >= 0 ? text.indexOf('npm ci') : text.indexOf('docker run');
      expect(removeAt, name).toBeGreaterThan(-1);
      expect(commandAt, name).toBeGreaterThan(removeAt);
    }
  });

  it('pins the Playwright runners and limits failure reports', () => {
    expect(jobText('e2e-sqlite')).toContain('runs-on: ubuntu-24.04');
    expect(jobText('e2e-postgres')).toContain('runs-on: ubuntu-24.04');
    expect(jobText('e2e-sqlite')).not.toContain('ubuntu-latest');
    expect(jobText('e2e-postgres')).not.toContain('ubuntu-latest');
    expect(workflow.match(/retention-days: 1/g) ?? []).toHaveLength(2);
    expect(workflow).not.toContain('/tmp/');
    expect(workflow).not.toContain('path: data');
    expect(workflow).not.toContain('path: .env');
  });

  it('does not put GitHub expressions inside run scripts', () => {
    const scripts = runScripts(workflow);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script).not.toContain('${{');
    }
  });
});
