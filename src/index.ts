import { Env, ServerStatus } from './types';
import { sendTelegramMessage } from './telegram';
import { Router, IRequest } from 'itty-router';

// Extend IRequest to include our custom properties if needed
interface AuthenticatedRequest extends IRequest {
  serverName?: string; // To pass validated serverName from middleware
}

const router = Router();

// Middleware: Authentication
function authenticateRequest(request: IRequest, env: Env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized: Missing or invalid Authorization header', { status: 401 });
  }
  const token = authHeader.substring('Bearer '.length);
  if (token !== env.ACCESS_TOKEN) {
    return new Response('Unauthorized: Invalid token', { status: 401 });
  }
  // No explicit return means success for itty-router middleware.
}

// Middleware: Validate server_name
// Itty-router automatically parses query params into `request.query`
function validateServerName(request: AuthenticatedRequest, env: Env) {
  const serverName = request.query?.server_name as string | undefined;

  if (!serverName) {
    return new Response('Bad Request: Missing server_name query parameter', { status: 400 });
  }

  const allowedServers = env.SERVERS.split(',').map(s => s.trim());
  if (!allowedServers.includes(serverName)) {
    return new Response(`Bad Request: Invalid server_name '${serverName}'. Allowed: ${allowedServers.join(', ')}`, { status: 400 });
  }
  // Attach the validated serverName to the request object for the next handler
  request.serverName = serverName;
}


// Route Handler: POST /hello
async function handleHelloPost(request: AuthenticatedRequest, env: Env, ctx: ExecutionContext): Promise<Response> {
  // serverName is validated and attached by the validateServerName middleware
  const serverName = request.serverName!; // Add "!" as serverName is guaranteed by middleware
  const currentTime = Math.floor(Date.now() / 1000);

  try {
    // Get current status from D1
    let serverInfo: ServerStatus | null = await env.DB.prepare(
      "SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?"
    ).bind(serverName).first();

    if (serverInfo) { // Server exists in DB
      const previousState = serverInfo.last_state;
      serverInfo.last_hello_timestamp = currentTime;
      serverInfo.last_state = 'up';

      if (previousState === 'down') { // Server was down, now it's up
        const downTimeSeconds = currentTime - serverInfo.last_state_change_timestamp;
        const downTimeMinutes = Math.round(downTimeSeconds / 60);
        const downTimeDuration = downTimeSeconds < 60 ? `${downTimeSeconds}s` : `${downTimeMinutes}min`;

        serverInfo.last_state_change_timestamp = currentTime;
        // Update D1
        await env.DB.prepare(
          "UPDATE server_status SET last_hello_timestamp = ?, last_state = ?, last_state_change_timestamp = ? WHERE server_name = ?"
        ).bind(
          serverInfo.last_hello_timestamp,
          serverInfo.last_state,
          serverInfo.last_state_change_timestamp,
          serverName
        ).run();

        // Send notification
        const message = `✅ Server *${serverName}* is back UP.\nIt was down for approximately ${downTimeDuration}.`;
        ctx.waitUntil(sendTelegramMessage(env, message));
        console.log(`Notification sent: ${serverName} is UP after being down for ${downTimeDuration}.`);
        return new Response(`Hello received for ${serverName}. Server is now UP. Downtime was ${downTimeDuration}.`, { status: 200 });
      } else { // Server still up, just update hello time
        await env.DB.prepare(
          "UPDATE server_status SET last_hello_timestamp = ? WHERE server_name = ?"
        ).bind(serverInfo.last_hello_timestamp, serverName).run();
        console.log(`Hello received for ${serverName}. Status remains UP.`);
        return new Response(`Hello received for ${serverName}. Status remains UP.`, { status: 200 });
      }
    } else { // New server, first time hello
      serverInfo = {
        server_name: serverName,
        last_hello_timestamp: currentTime,
        last_state: 'up',
        last_state_change_timestamp: currentTime,
      };
      // Insert new server into D1
      await env.DB.prepare(
        "INSERT INTO server_status (server_name, last_hello_timestamp, last_state, last_state_change_timestamp) VALUES (?, ?, ?, ?)"
      ).bind(
        serverInfo.server_name,
        serverInfo.last_hello_timestamp,
        serverInfo.last_state,
        serverInfo.last_state_change_timestamp
      ).run();
      // Send notification
      const message = `👋 Server *${serverName}* sent its first ping and is now marked UP.`;
      ctx.waitUntil(sendTelegramMessage(env, message));
      console.log(`Notification sent: ${serverName} is newly UP.`);
      return new Response(`Hello received for new server ${serverName}. Marked as UP.`, { status: 201 });
    }
  } catch (e: any) {
    console.error(`D1 Error in /hello for server ${serverName}:`, e.message, e.cause);
    return new Response(`Database error processing ${serverName}: ${e.message}`, { status: 500 });
  }
}

// Register routes
// Note: itty-router executes middleware in order. If a middleware returns a Response, subsequent handlers are skipped.
router.post('/hello', authenticateRequest, validateServerName, handleHelloPost);

// Fallback for 404 - handles GET / as well now
router.all('*', () => new Response('Not found.', { status: 404 }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Scheduled task running at ${new Date().toISOString()}`);
    const serverNamesFromEnv = env.SERVERS.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const currentTime = Math.floor(Date.now() / 1000);
    const alertThresholdSeconds = 70; // Consider a server down if no hello for > 70 seconds (to allow for slight delays)

    for (const serverName of serverNamesFromEnv) {
      try {
        let serverInfo: ServerStatus | null = await env.DB.prepare(
          "SELECT server_name, last_hello_timestamp, last_state, last_state_change_timestamp FROM server_status WHERE server_name = ?"
        ).bind(serverName).first();

        if (serverInfo) {
          // Server exists in DB
          if (serverInfo.last_state === 'up' && (currentTime - serverInfo.last_hello_timestamp > alertThresholdSeconds)) {
            // Server was 'up' but missed pings, mark as 'down'
            console.log(`Server ${serverName} missed pings. Last hello: ${serverInfo.last_hello_timestamp}, Current time: ${currentTime}`);
            await env.DB.prepare(
              "UPDATE server_status SET last_state = 'down', last_state_change_timestamp = ? WHERE server_name = ?"
            ).bind(currentTime, serverName).run();

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
            "INSERT INTO server_status (server_name, last_hello_timestamp, last_state, last_state_change_timestamp) VALUES (?, ?, ?, ?)"
          ).bind(serverName, 0, 'down', currentTime).run(); // last_hello_timestamp as 0 or currentTime

          const message = `❓ Server *${serverName}* is configured but has not reported any status. Marking as DOWN.`;
          ctx.waitUntil(sendTelegramMessage(env, message));
          console.log(`Notification sent: ${serverName} is newly marked as DOWN (not found in DB).`);
        }
      } catch (e: any) {
        console.error(`Error processing server ${serverName} in scheduled task:`, e.message, e.cause);
        // Optionally send a Telegram message about the error itself if it's critical
        // ctx.waitUntil(sendTelegramMessage(env, `Worker error processing ${serverName}: ${e.message}`));
      }
    }
    console.log('Scheduled task finished.');
  }
};
