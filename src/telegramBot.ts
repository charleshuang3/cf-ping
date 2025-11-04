import { Bot, Context as GrammyContext, webhookCallback } from 'grammy';
import { Env, ServerStatus } from './types'; // Assuming types.ts exists and is correctly defined
import { Context as HonoContext } from 'hono'; // Import Hono's Context

interface MyContext extends GrammyContext {
  env: Env;
}

export function createTelegramBot(env: Env) {
  const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

  // Middleware to inject env
  bot.use(async (ctx, next) => {
    ctx.env = env;
    await next();
  });

  // Authenticate user
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id.toString() !== env.TELEGRAM_CHAT_ID) {
      console.log(`Unauthorized access attempt from chat ID: ${ctx.chat?.id}`);
      await ctx.reply('Sorry, you are not authorized to use this bot.');
      return;
    }
    await next();
  });

  function formatTimeDifference(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} second${seconds === 1 ? '' : 's'}`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds % 60} second${seconds % 60 === 1 ? '' : 's'}`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} hour${hours === 1 ? '' : 's'} ${minutes % 60} minute${minutes % 60 === 1 ? '' : 's'}`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ${hours % 24} hour${hours % 24 === 1 ? '' : 's'}`;
  }

  bot.command('status', async (ctx) => {
    try {
      const serverNamesFromEnv = ctx.env.SERVERS.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (serverNamesFromEnv.length === 0) {
        await ctx.reply('No servers configured to monitor.');
        return;
      }

      const statusMessages: string[] = [];
      statusMessages.push('*Server Status Report:*');

      const currentTime = Math.floor(Date.now() / 1000);
      const alertThresholdSeconds = 90; // Consistent with scheduled task

      for (const serverName of serverNamesFromEnv) {
        const serverInfo: ServerStatus | null = await ctx.env.DB.prepare(
          'SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?',
        )
          .bind(serverName)
          .first();

        if (serverInfo) {
          let statusEmoji = serverInfo.last_state === 'up' ? '✅' : '❗';
          let stateDetail = serverInfo.last_state.toUpperCase();
          let lastPingMessage = '';
          let lastStateChangeMessage = '';

          const oneWeekInSeconds = 7 * 24 * 60 * 60; // 1 week in seconds

          if (serverInfo.last_state === 'up') {
            // Check if 'up' server is actually stale
            if (currentTime - serverInfo.last_hello_timestamp > alertThresholdSeconds) {
              statusEmoji = '⚠️'; // Warning, potentially down
              stateDetail = `UP (Stale, last ping > ${alertThresholdSeconds}s ago)`;
              lastPingMessage = `  Last Seen: ${formatTimeDifference(currentTime - serverInfo.last_hello_timestamp)} ago`;
              lastStateChangeMessage = `  Last State Change: ${formatTimeDifference(currentTime - serverInfo.last_state_change_timestamp)} ago`;
            } else if (currentTime - serverInfo.last_state_change_timestamp > oneWeekInSeconds) {
              // If server is up and last state change is > 1 week, just say server up
              // No additional messages needed, lastPingMessage and lastStateChangeMessage remain empty
            } else {
              // Server is up and not stale, and state change is within 1 week
              lastStateChangeMessage = `  Last State Change: ${formatTimeDifference(currentTime - serverInfo.last_state_change_timestamp)} ago`;
            }
          } else {
            // serverInfo.last_state === 'down'
            stateDetail = `DOWN`; // Ensure it explicitly says DOWN
            lastPingMessage = `  Last Seen: ${formatTimeDifference(currentTime - serverInfo.last_hello_timestamp)} ago`;
            lastStateChangeMessage = `  Last State Change: ${formatTimeDifference(currentTime - serverInfo.last_state_change_timestamp)} ago`;
          }

          statusMessages.push(
            `\n*${serverName}*\n` +
              `${statusEmoji} Status: *${stateDetail}*` +
              (lastPingMessage ? `\n${lastPingMessage}` : '') +
              (lastStateChangeMessage ? `\n${lastStateChangeMessage}` : ''),
          );
        } else {
          statusMessages.push(`\n*${serverName}*\n` + `❓ Status: *UNKNOWN* (Not found in database)`);
        }
      }
      await ctx.reply(statusMessages.join('\n'), { parse_mode: 'Markdown' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error processing /status command:', errorMessage);
      await ctx.reply('Sorry, there was an error fetching the server status.');
    }
  });

  bot.on('message', (ctx) => ctx.reply('I only understand the /status command.'));

  return bot;
}

export async function handleTelegramWebhook(c: HonoContext, env: Env) {
  const bot = createTelegramBot(env);
  return webhookCallback(bot, 'hono')(c);
}
