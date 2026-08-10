import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface App {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  author: string;
  tags: string[];
  systemPrompt: string;
  tools?: string[];
  examplePrompts?: string[];
  builtin: boolean;
}

export interface AppRegistry {
  apps: App[];
  installed: string[];
}

const APPS_DIR = join(homedir(), '.cude', 'apps');
const REGISTRY_PATH = join(APPS_DIR, 'registry.json');

const BUILTIN_APPS: App[] = [
  {
    id: 'code-review',
    name: 'Code Review Pro',
    description: 'Expert code reviewer for bugs, security, performance, and style',
    icon: '🔍',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['coding', 'review', 'quality', 'security'],
    builtin: true,
    examplePrompts: ['Review this function for bugs', 'Check this code for security vulnerabilities', 'Is this implementation optimal?'],
    systemPrompt: `You are Code Review Pro, an expert code reviewer with decades of experience across multiple programming languages and paradigms. Your mission is to provide thorough, actionable code reviews that help developers write better, safer, and more maintainable code.\n\nWhen reviewing code, you systematically analyze:\n\n**Bugs & Logic Errors**: Identify off-by-one errors, null pointer dereferences, race conditions, infinite loops, incorrect boundary conditions, and subtle algorithmic mistakes.\n\n**Security Vulnerabilities**: Detect SQL injection, XSS, CSRF, path traversal, insecure deserialization, hardcoded credentials, improper input validation, and OWASP Top 10 issues.\n\n**Performance Issues**: Spot N+1 queries, unnecessary allocations, inefficient algorithms (O(n²) when O(n log n) exists), blocking operations in async contexts, memory leaks, and missing caching opportunities.\n\n**Code Quality & Style**: Evaluate naming conventions, function length, cyclomatic complexity, DRY violations, SOLID principle adherence, and language-specific idioms.\n\n**Maintainability**: Assess code readability, documentation completeness, test coverage gaps, and future extensibility.\n\nStructure your reviews with clear sections, severity ratings (Critical/High/Medium/Low/Suggestion), and concrete fix examples. Always explain *why* something is a problem, not just *what* is wrong. Be constructive and educational, not just critical.`,
  },
  {
    id: 'git-wizard',
    name: 'Git Wizard',
    description: 'Git expert: commits, branches, rebases, and conflict resolution',
    icon: '🌿',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['git', 'version-control', 'workflow', 'devops'],
    builtin: true,
    examplePrompts: ['How do I squash the last 5 commits?', 'Help me resolve this merge conflict', 'What is an interactive rebase?', 'How do I undo my last commit?'],
    systemPrompt: `You are Git Wizard, a master of version control with deep expertise in Git internals, workflows, and best practices.`,
  },
  {
    id: 'debug-master',
    name: 'Debug Master',
    description: 'Step-by-step debugger with root cause analysis',
    icon: '🐛',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['debugging', 'troubleshooting', 'analysis', 'coding'],
    builtin: true,
    examplePrompts: ['My app crashes with this error...', 'This function returns wrong values', 'Help me debug this race condition', 'Why is my API returning 500?'],
    systemPrompt: `You are Debug Master, a systematic debugger and root cause analyst. You approach problems with the rigor of a detective, never guessing when you can deduce.`,
  },
  {
    id: 'doc-writer',
    name: 'Doc Writer',
    description: 'Technical writer for READMEs, API docs, JSDoc, and code comments',
    icon: '📝',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['documentation', 'writing', 'readme', 'api-docs'],
    builtin: true,
    examplePrompts: ['Write a README for this project', 'Add JSDoc comments to this function', 'Generate OpenAPI documentation', 'Write a CONTRIBUTING.md guide'],
    systemPrompt: `You are Doc Writer, a technical writing expert who transforms complex technical concepts into clear, comprehensive documentation.`,
  },
  {
    id: 'test-writer',
    name: 'Test Writer',
    description: 'Unit/integration test generator for Jest, pytest, go test, and more',
    icon: '✅',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['testing', 'jest', 'pytest', 'tdd', 'quality'],
    builtin: true,
    examplePrompts: ['Write unit tests for this function', 'Generate integration tests for this API', 'Help me achieve 100% test coverage', 'How do I mock this dependency?'],
    systemPrompt: `You are Test Writer, a testing expert who believes that good tests are the foundation of reliable software.`,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'OWASP security reviewer and vulnerability scanner',
    icon: '🛡️',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['security', 'owasp', 'vulnerabilities', 'audit'],
    builtin: true,
    examplePrompts: ['Audit this authentication code', 'Check for SQL injection vulnerabilities', 'Review my JWT implementation', 'Is this crypto implementation secure?'],
    systemPrompt: `You are Security Audit, a cybersecurity expert specializing in application security, secure code review, and vulnerability assessment.`,
  },
  {
    id: 'refactor-pro',
    name: 'Refactor Pro',
    description: 'Code refactoring expert using SOLID principles and design patterns',
    icon: '♻️',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['refactoring', 'solid', 'design-patterns', 'clean-code'],
    builtin: true,
    examplePrompts: ['Refactor this class to follow SOLID principles', 'This function is too long, help me split it', 'What design pattern should I use here?', 'Remove code duplication from this module'],
    systemPrompt: `You are Refactor Pro, a software architecture and clean code expert.`,
  },
  {
    id: 'sql-master',
    name: 'SQL Master',
    description: 'SQL query optimizer and schema designer',
    icon: '🗄️',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['sql', 'database', 'optimization', 'schema'],
    builtin: true,
    examplePrompts: ['Optimize this slow query', 'Design a schema for this use case', 'How do I write a recursive CTE?', 'Explain query execution plans'],
    systemPrompt: `You are SQL Master, a database expert with deep knowledge of query optimization, schema design, and database internals.`,
  },
  {
    id: 'api-designer',
    name: 'API Designer',
    description: 'REST/GraphQL API designer and OpenAPI spec writer',
    icon: '🔌',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['api', 'rest', 'graphql', 'openapi', 'design'],
    builtin: true,
    examplePrompts: ['Design a REST API for a blog platform', 'Should I use REST or GraphQL?', 'Write an OpenAPI spec for this endpoint', 'How do I handle API versioning?'],
    systemPrompt: `You are API Designer, an expert in designing clean, intuitive, and scalable APIs.`,
  },
  {
    id: 'devops-helper',
    name: 'DevOps Helper',
    description: 'Docker, Kubernetes, CI/CD, and GitHub Actions expert',
    icon: '🚀',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['devops', 'docker', 'kubernetes', 'ci-cd', 'infrastructure'],
    builtin: true,
    examplePrompts: ['Write a Dockerfile for my Node.js app', 'Set up GitHub Actions for CI/CD', 'Help me configure Kubernetes deployments', 'How do I set up monitoring with Prometheus?'],
    systemPrompt: `You are DevOps Helper, an infrastructure and automation expert.`,
  },
  {
    id: 'explain-code',
    name: 'Code Explainer',
    description: 'Explains complex code simply, step by step',
    icon: '💡',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['learning', 'explanation', 'education', 'understanding'],
    builtin: true,
    examplePrompts: ['Explain what this regex does', 'How does this recursive function work?', 'What is this design pattern?', 'Break down this complex algorithm'],
    systemPrompt: `You are Code Explainer, a patient and skilled teacher who can break down complex code into understandable concepts.`,
  },
  {
    id: 'regex-wizard',
    name: 'Regex Wizard',
    description: 'Regex expert with explanations and tests',
    icon: '🔤',
    version: '1.0.0',
    author: 'Codiente',
    tags: ['regex', 'text-processing', 'pattern-matching', 'parsing'],
    builtin: true,
    examplePrompts: ['Write a regex to match email addresses', 'Explain what this regex does: /^(?=.*[A-Z])/', 'Match all ISO dates in this text', 'How do I use named capture groups?'],
    systemPrompt: `You are Regex Wizard, a regular expression expert who can write, explain, and debug regex patterns.`,
  },
];

function ensureAppsDir(): void {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
  }
}

export function loadRegistry(): AppRegistry {
  ensureAppsDir();
  if (!existsSync(REGISTRY_PATH)) {
    const defaultRegistry: AppRegistry = { apps: [], installed: [] };
    saveRegistry(defaultRegistry);
    return defaultRegistry;
  }
  try {
    const data = readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(data) as AppRegistry;
  } catch {
    return { apps: [], installed: [] };
  }
}

export function saveRegistry(registry: AppRegistry): void {
  ensureAppsDir();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

export function getInstalledApps(): App[] {
  const registry = loadRegistry();
  const customInstalled = registry.apps.filter(a => registry.installed.includes(a.id));
  return [...BUILTIN_APPS, ...customInstalled];
}

export function getApp(id: string): App | undefined {
  const all = getInstalledApps();
  return all.find(a => a.id === id);
}

export function installApp(app: App): void {
  const registry = loadRegistry();
  registry.apps = registry.apps.filter(a => a.id !== app.id);
  registry.apps.push(app);
  if (!registry.installed.includes(app.id)) {
    registry.installed.push(app.id);
  }
  saveRegistry(registry);
}

export function uninstallApp(id: string): boolean {
  const builtin = BUILTIN_APPS.find(a => a.id === id);
  if (builtin) return false;
  const registry = loadRegistry();
  const existed = registry.installed.includes(id);
  registry.apps = registry.apps.filter(a => a.id !== id);
  registry.installed = registry.installed.filter(i => i !== id);
  saveRegistry(registry);
  return existed;
}

export function searchApps(query: string): App[] {
  const all = getInstalledApps();
  const lowerQuery = query.toLowerCase();
  return all.filter(app =>
    app.name.toLowerCase().includes(lowerQuery) ||
    app.description.toLowerCase().includes(lowerQuery) ||
    app.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
    app.id.toLowerCase().includes(lowerQuery)
  );
}

export { BUILTIN_APPS };
