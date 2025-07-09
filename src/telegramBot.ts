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
      await ctx.reply("Sorry, you are not authorized to use this bot.");
      return;
    }
    await next();
  });

  bot.command('status', async (ctx) => {
    try {
      const serverNamesFromEnv = ctx.env.SERVERS.split(',').map(s => s.trim()).filter(s => s.length > 0);
      if (serverNamesFromEnv.length === 0) {
        await ctx.reply("No servers configured to monitor.");
        return;
      }

      let statusMessages: string[] = [];
      statusMessages.push("*Server Status Report:*");

      const currentTime = Math.floor(Date.now() / 1000);
      const alertThresholdSeconds = 70; // Consistent with scheduled task

      for (const serverName of serverNamesFromEnv) {
        const serverInfo: ServerStatus | null = await ctx.env.DB.prepare(
          "SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?"
        ).bind(serverName).first();

        if (serverInfo) {
          let statusEmoji = serverInfo.last_state === 'up' ? '✅' : '❗';
          let stateDetail = serverInfo.last_state.toUpperCase();
          const lastSeen = new Date(serverInfo.last_hello_timestamp * 1000).toLocaleString();
          const lastChange = new Date(serverInfo.last_state_change_timestamp * 1000).toLocaleString();

          // Check if 'up' server is actually stale
          if (serverInfo.last_state === 'up' && (currentTime - serverInfo.last_hello_timestamp > alertThresholdSeconds)) {
            statusEmoji = '⚠️'; // Warning, potentially down
            stateDetail = `UP (Stale, last ping > ${alertThresholdSeconds}s ago)`;
          }

          statusMessages.push(
            `\n*${serverName}*\n` +
            `${statusEmoji} Status: *${stateDetail}*\n` +
            `  Last Ping: ${lastSeen}\n` +
            `  Last State Change: ${lastChange}`
          );
        } else {
          statusMessages.push(
            `\n*${serverName}*\n` +
            `❓ Status: *UNKNOWN* (Not found in database)`
          );
        }
      }
      await ctx.reply(statusMessages.join('\n'), { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error("Error processing /status command:", error);
      await ctx.reply("Sorry, there was an error fetching the server status.");
    }
  });

  bot.on('message', (ctx) => ctx.reply('I only understand the /status command.'));

  return bot;
}

export async function handleTelegramWebhook(c: HonoContext, env: Env) {
  const bot = createTelegramBot(env);
  return webhookCallback(bot, 'hono')(c);
}
