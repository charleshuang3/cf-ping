import { Env, ServerStatus } from './types';
import { sendTelegramMessage } from './telegram';
import { handleTelegramWebhook } from './telegramBot'; // Import the new handler
import { Hono } from 'hono';
import { Context } from 'hono';
import { formatTimeDifference } from './utils';

const app = new Hono<{ Bindings: Env }>();

// Middleware: Authentication
async function authenticateRequest(c: Context, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.text('Unauthorized: Missing or invalid Authorization header', 401);
  }
  const token = authHeader.substring('Bearer '.length);
  if (token !== c.env.ACCESS_TOKEN) {
    return c.text('Unauthorized: Invalid token', 401);
  }
  await next();
}

// Middleware: Validate server_name
async function validateServerName(c: Context, next: () => Promise<void>) {
  const serverName = c.req.query('server_name');

  if (!serverName) {
    return c.text('Bad Request: Missing server_name query parameter', 400);
  }

  const allowedServers = c.env.SERVERS.split(',').map((s: string) => s.trim());
  if (!allowedServers.includes(serverName)) {
    return c.text(`Bad Request: Invalid server_name '${serverName}'. Allowed: ${allowedServers.join(', ')}`, 400);
  }
  c.set('serverName', serverName);
  await next();
}

// Route Handler: POST /hello
async function handleHelloPost(c: Context): Promise<Response> {
  const serverName = c.get('serverName');
  const currentTime = Math.floor(Date.now() / 1000);

  try {
    let serverInfo: ServerStatus | null = await c.env.DB.prepare(
      'SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?',
    )
      .bind(serverName)
      .first();

    if (serverInfo) {
      const previousState = serverInfo.last_state;
      const last_hello_timestamp = serverInfo.last_hello_timestamp;
      serverInfo.last_hello_timestamp = currentTime;
      serverInfo.last_state = 'up';

      if (previousState === 'down') {
        const downTimeSeconds = currentTime - last_hello_timestamp;
        const downTimeDuration = formatTimeDifference(downTimeSeconds);

        serverInfo.last_state_change_timestamp = currentTime;
        await c.env.DB.prepare(
          'UPDATE server_status SET last_hello_timestamp = ?, last_state = ?, last_state_change_timestamp = ? WHERE server_name = ?',
        )
          .bind(
            serverInfo.last_hello_timestamp,
            serverInfo.last_state,
            serverInfo.last_state_change_timestamp,
            serverName,
          )
          .run();

        const message = `✅ Server *${serverName}* is back UP.\nIt was down for approximately ${downTimeDuration}.`;
        c.executionCtx.waitUntil(sendTelegramMessage(c.env, message));
        console.log(`Notification sent: ${serverName} is UP after being down for ${downTimeDuration}.`);
        return c.text(`Hello received for ${serverName}. Server is now UP. Downtime was ${downTimeDuration}.`, 200);
      } else {
        await c.env.DB.prepare('UPDATE server_status SET last_hello_timestamp = ? WHERE server_name = ?')
          .bind(serverInfo.last_hello_timestamp, serverName)
          .run();
        console.log(`Hello received for ${serverName}. Status remains UP.`);
        return c.text(`Hello received for ${serverName}. Status remains UP.`, 200);
      }
    } else {
      serverInfo = {
        server_name: serverName,
        last_hello_timestamp: currentTime,
        last_state: 'up',
        last_state_change_timestamp: currentTime,
      };
      await c.env.DB.prepare(
        'INSERT INTO server_status (server_name, last_hello_timestamp, last_state, last_state_change_timestamp) VALUES (?, ?, ?, ?)',
      )
        .bind(
          serverInfo.server_name,
          serverInfo.last_hello_timestamp,
          serverInfo.last_state,
          serverInfo.last_state_change_timestamp,
        )
        .run();
      const message = `👋 Server *${serverName}* sent its first ping and is now marked UP.`;
      c.executionCtx.waitUntil(sendTelegramMessage(c.env, message));
      console.log(`Notification sent: ${serverName} is newly UP.`);
      return c.text(`Hello received for new server ${serverName}. Marked as UP.`, 201);
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`D1 Error in /hello for server ${serverName}:`, errorMessage);
    return c.text(`Database error processing ${serverName}: ${errorMessage}`, 500);
  }
}

// Register routes
app.post('/hello', authenticateRequest, validateServerName, handleHelloPost);

// Route for Telegram Bot Webhook
app.post('/tgbot', async (c) => {
  return handleTelegramWebhook(c, c.env);
});

// Fallback for 404
app.all('*', (c) => c.text('Not found.', 404));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Scheduled task running at ${new Date().toISOString()}`);
    const serverNamesFromEnv = env.SERVERS.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const currentTime = Math.floor(Date.now() / 1000);
    const alertThresholdSeconds = env.ALERT_THRESHOLD_SECONDS; // Consider a server down if no hello for > X seconds

    for (const serverName of serverNamesFromEnv) {
      try {
        const serverInfo: ServerStatus | null = await env.DB.prepare(
          'SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?',
        )
          .bind(serverName)
          .first();

        if (serverInfo) {
          // Server exists in DB
          if (serverInfo.last_state === 'up' && currentTime - serverInfo.last_hello_timestamp > alertThresholdSeconds) {
            // Server was 'up' but missed pings, mark as 'down'
            console.log(
              `Server ${serverName} missed pings. Last hello: ${serverInfo.last_hello_timestamp}, Current time: ${currentTime}`,
            );
            await env.DB.prepare(
              "UPDATE server_status SET last_state = 'down', last_state_change_timestamp = ? WHERE server_name = ?",
            )
              .bind(currentTime, serverName)
              .run();

            const message = `❗ Server *${serverName}* is DOWN. No ping received for over ${alertThresholdSeconds} seconds.`;
            ctx.waitUntil(sendTelegramMessage(env, message));
            console.log(`Notification sent: ${serverName} is DOWN.`);
          }
          // If serverInfo.last_state is 'down', we wait for a /hello to mark it up.
          // If serverInfo.last_state is 'up' and last_hello_timestamp is recent, do nothing.
        } else {
          // Server is in ENV but not in DB, this is the first time we're noticing it (or it was deleted from DB)
          // Add it as 'down' and notify.
          console.log(`Server ${serverName} from ENV not found in DB. Adding as 'down'.`);
          await env.DB.prepare(
            'INSERT INTO server_status (server_name, last_hello_timestamp, last_state, last_state_change_timestamp) VALUES (?, ?, ?, ?)',
          )
            .bind(serverName, 0, 'down', currentTime)
            .run(); // last_hello_timestamp as 0 or currentTime

          const message = `❓ Server *${serverName}* is configured but has not reported any status. Marking as DOWN.`;
          ctx.waitUntil(sendTelegramMessage(env, message));
          console.log(`Notification sent: ${serverName} is newly marked as DOWN (not found in DB).`);
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(`Error processing server ${serverName} in scheduled task:`, errorMessage);
        // Optionally send a Telegram message about the error itself if it's critical
        // ctx.waitUntil(sendTelegramMessage(env, `Worker error processing ${serverName}: ${errorMessage}`));
      }
    }
    console.log('Scheduled task finished.');
  },
};
