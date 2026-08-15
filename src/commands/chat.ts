import readline from 'readline';
import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from '../core/selector.js';
import {
  createSession,
  findSessionByName,

  saveSession,
  addMessageToSession,
  updateSessionCost,
  addActivityToSession,
  listSessions,
} from '../storage/sessions.js';
import { recordSpending, checkBudgetAlert, loadBudget } from '../storage/budget.js';
import { showBanner, showCostInfo, showError, showInfo, showSessionTable } from '../ui/display.js';
import type { Message } from '../providers/types.js';
import type { Session } from '../storage/sessions.js';
import { activityEntry, formatActivity, summarizeActivity, type ActivityEntry } from '../core/activity.js';

export interface ChatCommandOptions {
  provider?: string;
  model?: string;
  session?: string;
  free?: boolean;
  task?: TaskType;
  system?: string;
  noHistory?: boolean;
}

const CHAT_HELP = `
${chalk.bold.cyan('Chat Commands:')}
  ${chalk.yellow('/exit')}          Exit the chat
  ${chalk.yellow('/new')}           Start a new conversation
  ${chalk.yellow('/sessions')}      List all sessions
  ${chalk.yellow('/model <name>')}  Switch to a different model
  ${chalk.yellow('/budget')}        Show current budget status
  ${chalk.yellow('/clear')}         Clear the screen
  ${chalk.yellow('/save <name>')}   Save current session with a name
  ${chalk.yellow('/help')}          Show this help message
  ${chalk.yellow('/info')}          Show current session info
  ${chalk.yellow('/summary')}       Show the observable activity summary
  ${chalk.yellow('/activity')}      Show the latest activity events
  ${chalk.yellow('/history [n]')}   Show recent conversation turns
`;

export async function runChat(options: ChatCommandOptions = {}): Promise<void> {
  const {
    provider: preferredProvider,
    model: preferredModel,
    session: sessionName,
    free = false,
    task: taskType = 'general',
    system: systemPrompt,
    noHistory = false,
  } = options;

  // Select provider and model
  const selection = selectProviderAndModel(taskType, {
    free,
    preferredProvider,
    preferredModel,
  });
  const { reason } = selection;
  let { provider, model } = selection;

  // Load or create session
  let session: Session | null = null;
  if (sessionName && !noHistory) {
    session = findSessionByName(sessionName);
    if (!session) {
      session = createSession(sessionName, provider.name, model);
      showInfo(`Created new session: ${chalk.cyan(sessionName)}`);
    } else {
      showInfo(`Continuing session: ${chalk.cyan(sessionName)} (${session.messages.length} messages)`);
      // Use session's provider/model if not overridden
      if (!preferredProvider && !preferredModel) {
        try {
          const { getProvider } = await import('../providers/index.js');
          provider = getProvider(session.provider);
          model = session.model;
        } catch {
          // Keep current provider/model
        }
      }
    }
  }

  console.log();
  console.log(
    chalk.dim('  Provider: ') + chalk.cyan(provider.displayName) +
    chalk.dim('  Model: ') + chalk.cyan(model) +
    chalk.dim('  Mode: ') + chalk.cyan(free ? 'Free' : 'Standard')
  );
  if (reason) console.log(chalk.dim(`  (${reason})`));
  console.log(chalk.dim('  Type /help for commands, /exit to quit'));
  console.log();

  // Maintain conversation history
  const messages: Message[] = session ? [...session.messages] : [];
  const activity: ActivityEntry[] = session?.activity ? [...session.activity] : [];
  const recordActivity = (entry: ActivityEntry) => {
    activity.push(entry);
    if (session) {
      addActivityToSession(session, entry);
      saveSession(session);
    }
  };
  if (systemPrompt) {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Handle graceful exit
  rl.on('SIGINT', () => {
    console.log(chalk.dim('\n  Chat ended.'));
    if (session) saveSession(session);
    rl.close();
    process.exit(0);
  });

  const prompt = () => {
    const sessionLabel = session ? chalk.dim(`[${session.name}] `) : '';
    return `${sessionLabel}${chalk.green('You')}${chalk.dim(' › ')}`;
  };

  const askQuestion = (): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt(), resolve);
    });
  };

  while (true) {
    let userInput: string;
    try {
      userInput = await askQuestion();
    } catch {
      break;
    }

    userInput = userInput.trim();
    if (!userInput) continue;

    // Handle chat commands
    if (userInput.startsWith('/')) {
      const parts = userInput.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();

      if (cmd === 'exit' || cmd === 'quit') {
        console.log(chalk.dim('\n  Goodbye!'));
        if (session) saveSession(session);
        break;
      }

      if (cmd === 'help') {
        console.log(CHAT_HELP);
        continue;
      }

      if (cmd === 'clear') {
        console.clear();
        showBanner();
        continue;
      }

      if (cmd === 'new') {
        messages.length = 0;
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        session = null;
        console.log(chalk.dim('\n  Started new conversation.\n'));
        continue;
      }

      if (cmd === 'sessions') {
        const sessions = listSessions();
        showSessionTable(sessions);
        continue;
      }

      if (cmd === 'budget') {
        const budget = loadBudget();
        console.log();
        console.log(chalk.bold('  Budget Status:'));
        console.log(chalk.dim(`  Total spent:    `) + chalk.yellow(`$${budget.totalSpent.toFixed(6)}`));
        console.log(chalk.dim(`  Monthly spent:  `) + chalk.yellow(`$${budget.monthlySpent.toFixed(6)}`));
        if (budget.totalLimit) {
          console.log(chalk.dim(`  Total limit:    `) + chalk.cyan(`$${budget.totalLimit}`));
        }
        if (budget.monthlyLimit) {
          console.log(chalk.dim(`  Monthly limit:  `) + chalk.cyan(`$${budget.monthlyLimit}`));
        }
        console.log();
        continue;
      }

      if (cmd === 'model') {
        const newModel = parts[1];
        if (!newModel) {
          showInfo(`Current model: ${chalk.cyan(model)}`);
          continue;
        }
        const { MODELS } = await import('../config/models.js');
        const modelDef = MODELS[newModel];
        if (!modelDef) {
          showError(`Unknown model: ${newModel}`);
          continue;
        }
        const { getProvider } = await import('../providers/index.js');
        try {
          provider = getProvider(modelDef.provider);
          model = newModel;
          showInfo(`Switched to: ${chalk.cyan(model)} on ${chalk.cyan(provider.displayName)}`);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
        continue;
      }

      if (cmd === 'save') {
        const name = parts.slice(1).join(' ') || `session-${Date.now()}`;
        if (!session) {
          session = createSession(name, provider.name, model);
          // Add existing messages to the new session
          for (const msg of messages) {
            if (msg.role !== 'system') {
              addMessageToSession(session, msg);
            }
          }
        } else {
          session.name = name;
        }
        saveSession(session);
        showInfo(`Session saved as: ${chalk.cyan(name)}`);
        continue;
      }

      if (cmd === 'info') {
        console.log();
        console.log(chalk.dim(`  Provider:  `) + chalk.cyan(provider.displayName));
        console.log(chalk.dim(`  Model:     `) + chalk.cyan(model));
        console.log(chalk.dim(`  Messages:  `) + messages.filter(m => m.role !== 'system').length);
        if (session) {
          console.log(chalk.dim(`  Session:   `) + chalk.cyan(session.name));
          console.log(chalk.dim(`  Cost:      `) + chalk.yellow(`$${session.totalCost.toFixed(6)}`));
        }
        console.log();
        continue;
      }

      if (cmd === 'summary' || cmd === 'activity') {
        const summary = summarizeActivity(activity);
        console.log();
        console.log(chalk.bold.cyan('  Observable Activity Summary'));
        console.log(chalk.dim('  This records visible events, not private model reasoning or hidden chain-of-thought.'));
        console.log(chalk.dim(`  Turns: ${summary.turns}  Model calls: ${summary.modelCalls}  Tools: ${summary.toolCalls}`));
        console.log(chalk.dim(`  Approvals: ${summary.approvals}  Warnings: ${summary.warnings}  Errors: ${summary.errors}`));
        console.log(chalk.dim(`  Cost: $${summary.totalCost.toFixed(6)}  Tokens: ${summary.inputTokens} in / ${summary.outputTokens} out`));
        if (summary.lastAction) console.log(chalk.dim(`  Last observed action: ${summary.lastAction}`));
        if (cmd === 'activity') console.log(`\n${formatActivity(activity)}`);
        console.log();
        continue;
      }

      if (cmd === 'history') {
        const limit = Math.max(1, Number(parts[1] ?? 12) || 12);
        console.log();
        for (const message of messages.filter(m => m.role !== 'system').slice(-limit)) {
          const label = message.role === 'user' ? chalk.green('You') : message.role === 'tool' ? chalk.yellow('Tool') : chalk.blue('Assistant');
          console.log(label + ' ' + chalk.dim('›') + ' ' + message.content.slice(0, 1200) + '\n');
        }
        continue;
      }

      showError(`Unknown command: ${userInput}\nType /help for available commands`);
      continue;
    }

    // Regular chat message
    messages.push({ role: 'user', content: userInput });
    if (session) addMessageToSession(session, { role: 'user', content: userInput });
    recordActivity(activityEntry('user', 'User turn', `turn ${activity.filter(entry => entry.kind === 'user').length + 1}`));

    // Check budget
    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      showError(budgetCheck.message ?? 'Budget exceeded');
      messages.pop();
      if (session) session.messages.pop();
      continue;
    }

    if (budgetCheck.nearAlert && budgetCheck.message) {
      console.log(chalk.yellow(`  ⚠  ${budgetCheck.message}`));
    }

    console.log(chalk.blue('\nAssistant') + chalk.dim(' › '));

    try {
      let responseText = '';

      const response = await provider.streamChat(
        messages,
        model,
        { systemPrompt, maxTokens: 4096 },
        (chunk) => {
          if (!chunk.done && chunk.text) {
            process.stdout.write(chunk.text);
            responseText += chunk.text;
          }
        }
      );

      recordActivity(activityEntry('model', 'Model response', 'Streaming response completed', {
        provider: provider.name,
        model,
        cost: response.cost,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      }));

      console.log('\n');

      // Show rendered markdown if the response contains markdown
      if (responseText.includes('```') || responseText.includes('##') || responseText.includes('**')) {
        // Response was already streamed as raw text; no need to re-render
      }

      showCostInfo(response.cost, response.inputTokens, response.outputTokens);
      console.log();

      // Add to history
      messages.push({ role: 'assistant', content: responseText });

      // Update session
      if (session) {
        addMessageToSession(session, { role: 'assistant', content: responseText });
        updateSessionCost(session, response.cost, response.inputTokens, response.outputTokens);
        saveSession(session);
      }

      // Record spending
      if (response.cost > 0) {
        recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens, session?.id);
      }

    } catch (err) {
      recordActivity(activityEntry('error', 'Model request failed', err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240), { provider: provider.name, model }));
      console.log();
      showError(err instanceof Error ? err.message : String(err));
      // Remove the user message we just added on error
      messages.pop();
      if (session) session.messages.pop();
    }
  }

  rl.close();
}
