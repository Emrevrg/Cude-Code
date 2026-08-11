import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import type { ToolDefinition } from '../providers/types.js';
import type { ToolResult } from './tools.js';

export const RAG_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'rag_index',
    description: 'Index local files in a directory for semantic search. Builds an in-memory index of file contents.',
    parameters: {
      properties: {
        directory: {
          type: 'string',
          description: 'The directory to index',
        },
        extensions: {
          type: 'string',
          description: 'Comma-separated file extensions to include (default: ".ts,.js,.py,.md,.txt,.json,.yaml,.yml,.toml,.html,.css,.jsx,.tsx,.go,.rs,.java,.c,.cpp,.h,.rb,.php,.sh")',
        },
        max_files: {
          type: 'number',
          description: 'Maximum number of files to index (default: 500)',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'rag_search',
    description: 'Search indexed files using keyword matching. Returns the most relevant file chunks.',
    parameters: {
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        top_k: {
          type: 'number',
          description: 'Number of top results to return (default: 5)',
        },
        directory: {
          type: 'string',
          description: 'Optional: limit search to a specific indexed directory',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_summary',
    description: 'Get a summary of the indexed documents including file count, total size, and top-level structure',
    parameters: {
      properties: {
        directory: {
          type: 'string',
          description: 'Optional: show summary for a specific indexed directory',
        },
      },
      required: [],
    },
  },
];

interface IndexedChunk {
  filePath: string;
  content: string;
  lineStart: number;
  lineEnd: number;
  tokens: string[];
}

interface IndexEntry {
  directory: string;
  chunks: IndexedChunk[];
  fileCount: number;
  totalSize: number;
  indexedAt: string;
}

const indexes = new Map<string, IndexEntry>();

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.js', '.py', '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
  '.html', '.css', '.jsx', '.tsx', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.rb', '.php', '.sh', '.sql', '.xml', '.env', '.cfg', '.ini',
  '.dockerfile', '.vue', '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'vendor', '.cache', 'coverage', '.nyc_output',
  'target', 'bin', 'obj',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function chunkFile(filePath: string, content: string): IndexedChunk[] {
  const lines = content.split('\n');
  const chunks: IndexedChunk[] = [];
  const chunkSize = 40;
  const overlap = 10;

  for (let i = 0; i < lines.length; i += chunkSize - overlap) {
    const end = Math.min(i + chunkSize, lines.length);
    const chunkContent = lines.slice(i, end).join('\n');
    if (chunkContent.trim().length === 0) continue;

    chunks.push({
      filePath,
      content: chunkContent,
      lineStart: i + 1,
      lineEnd: end,
      tokens: tokenize(chunkContent),
    });
  }

  return chunks;
}

function collectFiles(
  dir: string,
  extensions: Set<string>,
  maxFiles: number,
  results: string[] = []
): string[] {
  if (results.length >= maxFiles) return results;

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (SKIP_DIRS.has(entry)) continue;
      if (entry.startsWith('.') && entry !== '.env') continue;

      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collectFiles(fullPath, extensions, maxFiles, results);
        } else if (stat.isFile() && stat.size < 512_000) {
          const ext = extname(entry).toLowerCase();
          if (extensions.has(ext) || entry === 'Dockerfile' || entry === 'Makefile') {
            results.push(fullPath);
          }
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // skip inaccessible dirs
  }

  return results;
}

export async function executeRagTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'rag_index':
      return ragIndex(
        args.directory as string,
        args.extensions as string | undefined,
        args.max_files as number | undefined
      );
    case 'rag_search':
      return ragSearch(
        args.query as string,
        args.top_k as number | undefined,
        args.directory as string | undefined
      );
    case 'rag_summary':
      return ragSummary(args.directory as string | undefined);
    default:
      return { success: false, output: '', error: `Unknown RAG tool: ${name}` };
  }
}

function ragIndex(directory: string, extensionsStr?: string, maxFiles?: number): ToolResult {
  try {
    const dir = resolve(directory);
    if (!existsSync(dir)) {
      return { success: false, output: '', error: `Directory not found: ${directory}` };
    }

    const extensions = extensionsStr
      ? new Set(extensionsStr.split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`))
      : DEFAULT_EXTENSIONS;

    const limit = maxFiles ?? 500;
    const files = collectFiles(dir, extensions, limit);

    const allChunks: IndexedChunk[] = [];
    let totalSize = 0;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        totalSize += content.length;
        const chunks = chunkFile(filePath.replace(dir + '/', ''), content);
        allChunks.push(...chunks);
      } catch {
        // skip unreadable files
      }
    }

    indexes.set(dir, {
      directory: dir,
      chunks: allChunks,
      fileCount: files.length,
      totalSize,
      indexedAt: new Date().toISOString(),
    });

    return {
      success: true,
      output: `Indexed ${files.length} files (${allChunks.length} chunks, ${(totalSize / 1024).toFixed(1)} KB) from ${dir}`,
    };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: `Indexing failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function ragSearch(query: string, topK?: number, directory?: string): ToolResult {
  const k = topK ?? 5;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return { success: false, output: '', error: 'Empty query' };
  }

  let allChunks: IndexedChunk[] = [];

  if (directory) {
    const dir = resolve(directory);
    const index = indexes.get(dir);
    if (!index) {
      return { success: false, output: '', error: `Directory not indexed: ${directory}. Run rag_index first.` };
    }
    allChunks = index.chunks;
  } else {
    for (const index of indexes.values()) {
      allChunks.push(...index.chunks);
    }
  }

  if (allChunks.length === 0) {
    return { success: false, output: '', error: 'No indexed documents. Run rag_index first.' };
  }

  const scored = allChunks.map(chunk => {
    let score = 0;
    const contentLower = chunk.content.toLowerCase();

    for (const qt of queryTokens) {
      const tokenMatches = chunk.tokens.filter(t => t.includes(qt)).length;
      score += tokenMatches * 2;

      if (contentLower.includes(qt)) {
        score += 3;
      }

      if (chunk.filePath.toLowerCase().includes(qt)) {
        score += 5;
      }
    }

    const fullQuery = query.toLowerCase();
    if (contentLower.includes(fullQuery)) {
      score += 10;
    }

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k).filter(s => s.score > 0);

  if (top.length === 0) {
    return { success: true, output: 'No relevant results found for the query.' };
  }

  const results = top.map((s, i) => {
    const preview = s.chunk.content.length > 300
      ? s.chunk.content.substring(0, 300) + '...'
      : s.chunk.content;
    return `[${i + 1}] ${s.chunk.filePath}:${s.chunk.lineStart}-${s.chunk.lineEnd} (score: ${s.score})\n${preview}`;
  });

  return {
    success: true,
    output: results.join('\n\n---\n\n'),
  };
}

function ragSummary(directory?: string): ToolResult {
  if (indexes.size === 0) {
    return { success: true, output: 'No directories indexed yet. Use rag_index to index a directory.' };
  }

  if (directory) {
    const dir = resolve(directory);
    const index = indexes.get(dir);
    if (!index) {
      return { success: false, output: '', error: `Directory not indexed: ${directory}` };
    }

    const fileSet = new Set(index.chunks.map(c => c.filePath));
    const fileList = Array.from(fileSet).slice(0, 20);

    return {
      success: true,
      output: [
        `Directory: ${index.directory}`,
        `Files: ${index.fileCount}`,
        `Chunks: ${index.chunks.length}`,
        `Total size: ${(index.totalSize / 1024).toFixed(1)} KB`,
        `Indexed at: ${index.indexedAt}`,
        '',
        'Sample files:',
        ...fileList.map(f => `  ${f}`),
        fileSet.size > 20 ? `  ... and ${fileSet.size - 20} more` : '',
      ].join('\n'),
    };
  }

  const lines = ['Indexed directories:'];
  for (const [dir, index] of indexes.entries()) {
    lines.push(`  ${dir}: ${index.fileCount} files, ${index.chunks.length} chunks, ${(index.totalSize / 1024).toFixed(1)} KB`);
  }
  return { success: true, output: lines.join('\n') };
}
