import readline from 'readline';
import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import {
  createSession,
  findSessionByName,
  saveSession,
  addMessageToSession,
  updateSessionCost,
  listSessions,
} from '../storage/sessions.js';
import { recordSpending, checkBudgetAlert, loadBudget } from '../storage/budget.js';
import { showBanner, showChatHeader, showCostInfo, showError, showInfo, showSessionTable, showAppTable, USER_PROMPT, AI_PROMPT } from '../ui/display.js';
import { getLanguage } from '../config/index.js';
import { getMemoryContext, updateMemory, getMemoryPath } from '../storage/memory.js';
import { runVote } from '../core/vote.js';
import { shouldCompress, compressContext } from '../core/compression.js';
import type { Message } from '../providers/types.js';
import type { Session } from '../storage/sessions.js';

export interface ChatCommandOptions {
  provider?: string;
  model?: string;
  session?: string;
  free?: boolean;
  task?: TaskType;
  system?: string;
  noHistory?: boolean;
  lang?: string;
  continue?: boolean;
}

const LANG_NAMES: Record<string, string> = {
  tr: 'Turkish', en: 'English', de: 'German', fr: 'French',
  es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  pl: 'Polish', ru: 'Russian', ar: 'Arabic', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', sv: 'Swedish',
};

// Keys that indicate 401/auth errors from any provider
function isAuthError(msg: string): boolean {
  return msg.includes('401') || msg.includes('invalid_api_key') ||
         msg.includes('Invalid API Key') || msg.includes('Unauthorized') ||
         msg.includes('authentication') || msg.includes('API key');
}

function authErrorHelp(providerName: string, displayName: string): string {
  const urls: Record<string, string> = {
    anthropic:   'console.anthropic.com → API Keys',
    openai:      'platform.openai.com → API keys',
    gemini:      'aistudio.google.com → Get API key',
    groq:        'console.groq.com → API Keys',
    openrouter:  'openrouter.ai/keys',
    nvidia:      'integrate.api.nvidia.com',
    mistral:     'console.mistral.ai → API Keys',
    together:    'api.together.xyz → Settings → API Keys',
    perplexity:  'www.perplexity.ai → Settings → API',
    deepseek:    'platform.deepseek.com → API Keys',
    xai:         'console.x.ai → API Keys',
    cohere:      'dashboard.cohere.com → API Keys',
  };
  const url = urls[providerName] ?? 'provider dashboard';
  return [
    `Authentication failed for ${displayName}`,
    ``,
    `Your API key was rejected. Things to check:`,
    `  • Key was copied fully (no spaces/missing chars)`,
    `  • Key is still active (not expired/revoked)`,
    `  • You have credits/quota remaining`,
    ``,
    `Get or refresh your key:  ${url}`,
    `Then update:  cude config set-key ${providerName}`,
  ].join('\n');
}

const CHAT_HELP = `
${chalk.bold.cyan('Chat Commands:')}
  ${chalk.yellow('/exit')}                    Exit the chat
  ${chalk.yellow('/new')}                     Start a new conversation
  ${chalk.yellow('/sessions')}                List all sessions
  ${chalk.yellow('/model <name>')}            Switch model
  ${chalk.yellow('/lang <code>')}             Switch language (tr/en/de/fr/es/...)
  ${chalk.yellow('/budget')}                  Show current budget status
  ${chalk.yellow('/clear')}                   Clear the screen
  ${chalk.yellow('/save <name>')}             Save current session with a name
  ${chalk.yellow('/provider <name>')}         Switch provider
  ${chalk.yellow('/info')}                    Show current session info
  ${chalk.yellow('/apps')}                    Show available apps / select one
  ${chalk.yellow('/apps <id>')}               Activate an app by ID
  ${chalk.yellow('/memory')}                  Show current memory content
  ${chalk.yellow('/memory update <text>')}    Add text to MEMORY.md
  ${chalk.yellow('/remember <text>')}         Quick shortcut to save to memory
  ${chalk.yellow('/compress')}                Manually compress conversation context
  ${chalk.yellow('/vote <question>')}         Ask all configured providers the same question in parallel
  ${chalk.yellow('/help')}                    Show this help message
`;

export async function runChat(options: ChatCommandOptions = {}): Promise<void> {
  const {
    provider: preferredProvider,
    model: preferredModel,
    free = false,
    task: taskType = 'general',
    system: systemPromptArg,
    noHistory = false,
  } = options;

  // Handle --continue flag: find most recent session
  let sessionName = options.session;
  if (options.continue && !sessionName) {
    const sessions = listSessions();
    if (sessions.length > 0) {
      sessionName = sessions[0].id;
      showInfo(`Continuing most recent session: ${chalk.cyan(sessions[0].name)}`);
    } else {
      showInfo('No previous sessions found. Starting fresh.');
    }
  }

  // Resolve language: flag > config > auto
  let language = options.lang ?? getLanguage();

  // Select provider and model — throws if nothing configured
  let provider: ReturnType<typeof selectProviderAndModel>['provider'];
  let model: string;
  let reason: string;
  try {
    const sel = selectProviderAndModel(taskType, { free, preferredProvider, preferredModel });
    provider = sel.provider; model = sel.model; reason = sel.reason;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Load memory context
  const memoryContext = getMemoryContext();
  const hasMemory = memoryContext.length > 0;

  // Build system prompt including language instruction and memory
  function buildSystemPrompt(base?: string): string | undefined {
    const langName = LANG_NAMES[language];
    const langInstruction = langName
      ? `Always respond in ${langName}. If the user writes in another language, still reply in ${langName}.`
      : '';

    const parts: string[] = [];
    if (langInstruction) parts.push(langInstruction);
    if (hasMemory && memoryContext) parts.push(memoryContext);
    if (base) parts.push(base);

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  let activeSystemPrompt = buildSystemPrompt(systemPromptArg);
  // Track the "app/user" base prompt separately for rebuilding
  let baseSystemPrompt = systemPromptArg;

  // Load or create session
  let session: Session | null = null;
  if (sessionName && !noHistory) {
    // Try by ID first, then by name
    const { loadSession } = await import('../storage/sessions.js');
    session = loadSession(sessionName) ?? findSessionByName(sessionName);
    if (!session) {
      session = createSession(sessionName, provider.name, model);
      showInfo(`Created new session: ${chalk.cyan(sessionName)}`);
    } else {
      showInfo(`Continuing session: ${chalk.cyan(session.name)} (${session.messages.filter(m => m.role !== 'system').length} messages)`);
      if (!preferredProvider && !preferredModel) {
        try {
          const { getProvider } = await import('../providers/index.js');
          provider = getProvider(session.provider);
          model = session.model;
        } catch { /* keep current */ }
      }
    }
  }

  showChatHeader({
    provider: provider.displayName,
    model,
    mode: free ? 'free' : 'paid',
    language: language !== 'auto' ? language : undefined,
    session: session?.name,
    memory: hasMemory ? '(memory loaded)' : undefined,
  });
  if (reason) console.log(chalk.dim(`  ↳ ${reason}`));

  const messages: Message[] = session ? [...session.messages] : [];
  // Always apply current system prompt (language + memory may have changed since session was saved)
  if (activeSystemPrompt) {
    const sysIdx = messages.findIndex(m => m.role === 'system');
    if (sysIdx >= 0) {
      messages[sysIdx].content = activeSystemPrompt;
    } else {
      messages.unshift({ role: 'system', content: activeSystemPrompt });
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let sigintFired = false;
  let partialResponse = ''; // captures in-flight streamed text on Ctrl+C
  let alertShown = false;   // budget near-alert: shown only once per session

  rl.on('SIGINT', () => {
    if (sigintFired) return;
    sigintFired = true;
    process.stdout.write('\x1B[?25h'); // always restore cursor
    console.log(chalk.dim('\n  Chat ended.'));
    // Flush any partial streamed response that was in-flight
    if (session && partialResponse) {
      addMessageToSession(session, { role: 'assistant', content: partialResponse + ' [interrupted]' });
    }
    if (session) saveSession(session);
    rl.close();
    process.exit(0);
  });

  const askQuestion = (): Promise<string> =>
    new Promise(resolve => rl.question('\n' + USER_PROMPT, resolve));

  while (true) {
    let userInput: string;
    try {
      userInput = await askQuestion();
    } catch {
      break;
    }

    userInput = userInput.trim();
    if (!userInput) continue;

    // ── Chat commands ──────────────────────────────────────────────────────
    if (userInput.startsWith('/')) {
      const parts = userInput.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();

      if (cmd === 'exit' || cmd === 'quit') {
        console.log(chalk.dim('\n  Goodbye!'));
        if (session) saveSession(session);
        sigintFired = true; // prevent SIGINT handler firing after rl.close()
        break;
      }

      if (cmd === 'help') { console.log(CHAT_HELP); continue; }

      if (cmd === 'clear') { console.clear(); showBanner(); continue; }

      if (cmd === 'new') {
        messages.length = 0;
        if (activeSystemPrompt) messages.push({ role: 'system', content: activeSystemPrompt });
        session = null;
        console.log(chalk.dim('\n  New conversation started.\n'));
        continue;
      }

      if (cmd === 'sessions') { showSessionTable(listSessions()); continue; }

      if (cmd === 'budget') {
        const budget = loadBudget();
        console.log();
        console.log(chalk.bold('  Budget Status:'));
        console.log(chalk.dim('  Total spent:   ') + chalk.yellow(`$${budget.totalSpent.toFixed(6)}`));
        console.log(chalk.dim('  Monthly spent: ') + chalk.yellow(`$${budget.monthlySpent.toFixed(6)}`));
        if (budget.totalLimit)   console.log(chalk.dim('  Total limit:   ') + chalk.cyan(`$${budget.totalLimit}`));
        if (budget.monthlyLimit) console.log(chalk.dim('  Monthly limit: ') + chalk.cyan(`$${budget.monthlyLimit}`));
        console.log();
        continue;
      }

      if (cmd === 'lang') {
        const newLang = parts[1]?.toLowerCase();
        const langs = Object.keys(LANG_NAMES).concat(['auto']);
        if (!newLang) {
          console.log(chalk.dim(`  Current: ${language}`));
          console.log(chalk.dim(`  Available: ${langs.join(', ')}`));
          continue;
        }
        if (!langs.includes(newLang)) {
          showError(`Unknown language: ${newLang}\nAvailable: ${langs.join(', ')}`);
          continue;
        }
        language = newLang;
        activeSystemPrompt = buildSystemPrompt(baseSystemPrompt);
        const sysIdx = messages.findIndex(m => m.role === 'system');
        if (activeSystemPrompt) {
          if (sysIdx >= 0) messages[sysIdx].content = activeSystemPrompt;
          else messages.unshift({ role: 'system', content: activeSystemPrompt });
        } else if (sysIdx >= 0) {
          messages.splice(sysIdx, 1);
        }
        showInfo(`Language switched to: ${chalk.cyan(newLang.toUpperCase())} (${LANG_NAMES[newLang] ?? 'Auto'})`);
        continue;
      }

      if (cmd === 'model') {
        const newModel = parts[1];
        if (!newModel) { showInfo(`Current model: ${chalk.cyan(model)}`); continue; }
        const { MODELS } = await import('../config/models.js');
        const modelDef = MODELS[newModel];
        if (!modelDef) {
          showError(`Unknown model: ${newModel}\nRun: cude providers models`);
          continue;
        }
        const { getProvider } = await import('../providers/index.js');
        try {
          const newProvider = getProvider(modelDef.provider);
          if (newProvider.name !== provider.name) {
            showInfo(`Switching provider to ${chalk.cyan(newProvider.displayName)} for this model`);
          }
          provider = newProvider;
          model = newModel;
          showInfo(`Switched to: ${chalk.cyan(model)} on ${chalk.cyan(provider.displayName)}`);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
        continue;
      }

      if (cmd === 'provider') {
        const newProv = parts[1]?.toLowerCase();
        if (!newProv) { showInfo(`Current provider: ${chalk.cyan(provider.displayName)}`); continue; }
        const { getProvider } = await import('../providers/index.js');
        try {
          const newProvider = getProvider(newProv);
          if (!newProvider.isConfigured()) {
            showError(`${newProvider.displayName} is not configured.\nRun: cude config set-key ${newProv}`);
            continue;
          }
          provider = newProvider;
          const models = provider.listModels();
          model = models[0]?.id ?? 'default';
          showInfo(`Switched to: ${chalk.cyan(provider.displayName)}  Model: ${chalk.cyan(model)}`);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
        continue;
      }

      if (cmd === 'save') {
        const name = parts.slice(1).join(' ') || `session-${Date.now()}`;
        if (!session) {
          session = createSession(name, provider.name, model);
          for (const msg of messages) {
            if (msg.role !== 'system') addMessageToSession(session, msg);
          }
        } else {
          session.name = name;
          // Keep provider/model in sync if user switched mid-session
          session.provider = provider.name;
          session.model = model;
        }
        saveSession(session);
        showInfo(`Session saved as: ${chalk.cyan(name)}`);
        continue;
      }

      if (cmd === 'info') {
        console.log();
        console.log(chalk.dim('  Provider:  ') + chalk.cyan(provider.displayName));
        console.log(chalk.dim('  Model:     ') + chalk.cyan(model));
        console.log(chalk.dim('  Language:  ') + chalk.cyan(language));
        console.log(chalk.dim('  Messages:  ') + messages.filter(m => m.role !== 'system').length);
        const memPaths = getMemoryPath();
        console.log(chalk.dim('  Memory:    ') + (hasMemory ? chalk.green('loaded') : chalk.dim('empty')));
        console.log(chalk.dim('  Mem path:  ') + chalk.dim(memPaths.memory));
        if (session) {
          console.log(chalk.dim('  Session:   ') + chalk.cyan(session.name));
          console.log(chalk.dim('  Cost:      ') + chalk.yellow(`$${session.totalCost.toFixed(6)}`));
        }
        console.log();
        continue;
      }

      // ── /apps command ────────────────────────────────────────────────────
      if (cmd === 'apps') {
        const appId = parts[1];
        if (appId) {
          // Directly activate an app
          const { getApp } = await import('../apps/registry.js');
          const app = getApp(appId);
          if (!app) {
            showError(`App not found: ${appId}\nRun: /apps to see available apps`);
            continue;
          }
          baseSystemPrompt = app.systemPrompt;
          activeSystemPrompt = buildSystemPrompt(app.systemPrompt);
          const sysIdx = messages.findIndex(m => m.role === 'system');
          if (activeSystemPrompt) {
            if (sysIdx >= 0) messages[sysIdx].content = activeSystemPrompt;
            else messages.unshift({ role: 'system', content: activeSystemPrompt });
          }
          showInfo(`${app.icon} Activated: ${chalk.cyan(app.name)}`);
          console.log(chalk.dim(`  ${app.description}`));
        } else {
          // Show app list
          const { getInstalledApps } = await import('../apps/registry.js');
          const apps = getInstalledApps();
          showAppTable(apps);
          console.log(chalk.dim('  Type /apps <id> to activate an app'));
        }
        continue;
      }

      // ── /memory command ──────────────────────────────────────────────────
      if (cmd === 'memory') {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'update') {
          const text = parts.slice(2).join(' ');
          if (!text) {
            showError('Usage: /memory update <text>');
            continue;
          }
          updateMemory(text);
          showInfo('Memory updated.');
        } else {
          // Show current memory content
          const currentMemory = getMemoryContext();
          if (!currentMemory) {
            const paths = getMemoryPath();
            showInfo(`Memory is empty.\nPaths:\n  ${paths.memory}\n  ${paths.user}`);
          } else {
            console.log();
            console.log(chalk.bold.cyan('  Current Memory:'));
            console.log(chalk.dim('  ' + '─'.repeat(50)));
            console.log(currentMemory.split('\n').map(l => '  ' + l).join('\n'));
            console.log(chalk.dim('  ' + '─'.repeat(50)));
            console.log();
          }
        }
        continue;
      }

      // ── /remember shortcut ───────────────────────────────────────────────
      if (cmd === 'remember') {
        const text = parts.slice(1).join(' ');
        if (!text) {
          showError('Usage: /remember <text to remember>');
          continue;
        }
        updateMemory(text);
        showInfo(`Saved to memory: ${chalk.dim(text.substring(0, 60))}${text.length > 60 ? '...' : ''}`);
        continue;
      }

      // ── /compress command ────────────────────────────────────────────────
      if (cmd === 'compress') {
        const nonSystem = messages.filter(m => m.role !== 'system');
        if (nonSystem.length < 4) {
          showInfo('Not enough messages to compress.');
          continue;
        }
        showInfo('Compressing conversation context...');
        try {
          const compressed = await compressContext(messages, provider, model);
          messages.length = 0;
          messages.push(...compressed);
          const newNonSystem = compressed.filter(m => m.role !== 'system').length;
          showInfo(`(compressed) Context reduced to ${newNonSystem} messages.`);
        } catch {
          showError('Compression failed.');
        }
        continue;
      }

      // ── /vote command ────────────────────────────────────────────────────
      if (cmd === 'vote') {
        const question = parts.slice(1).join(' ');
        if (!question) {
          showError('Usage: /vote <question>');
          continue;
        }
        showInfo(`Asking all configured providers: ${chalk.dim(question.slice(0, 60))}...`);
        try {
          const voteResult = await runVote(
            [...messages, { role: 'user', content: question }],
            { systemPrompt: activeSystemPrompt, onProgress: (m) => process.stdout.write(chalk.dim(`\r  ${m}         `)) }
          );
          process.stdout.write('\r' + ' '.repeat(60) + '\r');

          console.log();
          console.log(chalk.bold.hex('#7c3aed')('  ◈ Vote Results'));
          console.log(chalk.dim('  ' + '─'.repeat(50)));

          for (const candidate of voteResult.all) {
            const isWinner = candidate === voteResult.winner;
            const label = isWinner
              ? chalk.bold.green(`  ★ ${candidate.providerDisplayName} / ${candidate.model}`)
              : chalk.dim(`  • ${candidate.providerDisplayName} / ${candidate.model}`);
            console.log(label);

            if (candidate.error) {
              console.log(chalk.red(`    Error: ${candidate.error.slice(0, 100)}`));
            } else {
              const preview = candidate.content.slice(0, 300);
              preview.split('\n').forEach(l => console.log(chalk.dim('    ') + (isWinner ? chalk.white(l) : chalk.dim(l))));
              if (candidate.content.length > 300) console.log(chalk.dim('    ...'));
            }
            console.log();
          }

          console.log(chalk.dim(`  Winner: ${voteResult.winner.providerDisplayName} (score ${voteResult.winner.score.toFixed(0)})`));
          showCostInfo(voteResult.totalCost, 0, 0);

          // Optionally inject winner's answer into the conversation
          messages.push({ role: 'user', content: question });
          messages.push({ role: 'assistant', content: voteResult.winner.content });
          if (session) {
            addMessageToSession(session, { role: 'user', content: question });
            addMessageToSession(session, { role: 'assistant', content: voteResult.winner.content });
            saveSession(session);
          }
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
        continue;
      }

      showError(`Unknown command: ${userInput}\nType /help for available commands`);
      continue;
    }

    // ── Regular message ────────────────────────────────────────────────────
    messages.push({ role: 'user', content: userInput });
    if (session) addMessageToSession(session, { role: 'user', content: userInput });

    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      showError(budgetCheck.message ?? 'Budget exceeded');
      messages.pop();
      if (session) {
        session.messages.pop();
        saveSession(session); // persist the rollback to disk
      }
      continue;
    }
    if (budgetCheck.nearAlert && budgetCheck.message && !alertShown) {
      console.log(chalk.yellow(`  ⚠  ${budgetCheck.message}`));
      alertShown = true; // only warn once per session
    }

    process.stdout.write('\n' + AI_PROMPT);
    // Hide cursor while streaming for a cleaner look
    process.stdout.write('\x1B[?25l');

    try {
      let responseText = '';
      partialResponse = '';
      const response = await provider.streamChat(
        messages,
        model,
        { systemPrompt: activeSystemPrompt, maxTokens: 4096 },
        (chunk) => {
          if (!chunk.done && chunk.text) {
            process.stdout.write(chunk.text);
            responseText += chunk.text;
            partialResponse = responseText;
          }
        }
      );
      partialResponse = '';
      // Restore cursor
      process.stdout.write('\x1B[?25h');

      console.log('\n');
      showCostInfo(response.cost, response.inputTokens, response.outputTokens);

      messages.push({ role: 'assistant', content: responseText });

      if (session) {
        addMessageToSession(session, { role: 'assistant', content: responseText });
        updateSessionCost(session, response.cost, response.inputTokens, response.outputTokens);
        saveSession(session);
      }

      if (response.cost > 0) {
        recordSpending(
          provider.name, model, response.cost,
          response.inputTokens, response.outputTokens, session?.id
        );
      }

      // Auto-compress if needed
      if (shouldCompress(messages)) {
        try {
          const compressed = await compressContext(messages, provider, model);
          if (compressed.length < messages.length) {
            messages.length = 0;
            messages.push(...compressed);
            const newNonSystem = compressed.filter(m => m.role !== 'system').length;
            console.log(chalk.dim(`  (compressed) Context auto-compressed to ${newNonSystem} messages.`));
          }
        } catch {
          // Silently fail auto-compression
        }
      }

    } catch (err) {
      process.stdout.write('\x1B[?25h'); // restore cursor on error
      partialResponse = '';
      console.log();
      const msg = err instanceof Error ? err.message : String(err);
      if (isAuthError(msg)) {
        showError(authErrorHelp(provider.name, provider.displayName));
      } else if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        showError(
          provider.name === 'ollama'
            ? 'Ollama is not running.\n\nStart it:  ollama serve\nOr switch provider:  /provider groq'
            : `Connection failed for ${provider.displayName}.\n\nTry: /provider groq  (free, no connection issues)`
        );
      } else {
        showError(msg);
      }
      messages.pop();
      if (session) {
        session.messages.pop();
        saveSession(session); // persist the rollback so disk stays consistent
      }
    }
  }

  rl.close();
}
