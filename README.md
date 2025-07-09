# Server Ping Monitor - Cloudflare Worker

This Cloudflare Worker monitors the status of your servers by listening for pings. It uses Cloudflare D1 to store server status and sends notifications via Telegram when a server's state changes (up to down, or down to up, including downtime duration).

## Features

- **Server Uptime/Downtime Tracking:** Receives pings via a secure endpoint and records the last contact time.
- **D1 Database Integration:** Stores server name, last hello timestamp, current state ('up'/'down'), and the timestamp of the last state change.
- **Telegram Notifications:** Sends alerts when a server goes down or comes back online. Downtime duration is included in recovery messages.
- **Scheduled Checks:** A cron job runs every minute to check if any monitored server has missed its expected ping, marking it as 'down'.
- **Secure Endpoint:** The `/hello` endpoint requires bearer token authentication.
- **Environment Variable Configuration:** Easily configure server lists, Telegram bot details, and access tokens.
- **Built with TypeScript:** Type-safe and modern JavaScript.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) (Cloudflare's CLI tool)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A Telegram Bot and its Token, and your Chat ID.

## Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/charleshuang3/cf-ping
    cd cf-ping
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

## D1 Database Setup

This worker requires a Cloudflare D1 database to store server statuses.

1.  **Create a D1 Database:**
    If you don't have one already, create it using Wrangler. Replace `<YOUR_DB_NAME>` with your desired database name (e.g., `server-monitor-db`).
    ```bash
    wrangler d1 create <YOUR_DB_NAME>
    ```
    This command will output the `database_name` and `database_id`.

2.  **Configure `wrangler.toml`:**
    Open `wrangler.toml` and update the `[[d1_databases]]` section with the details from the previous step:
    ```toml
    [[d1_databases]]
    binding = "DB"
    database_name = "<YOUR_DB_NAME>" # e.g., "server-monitor-db"
    database_id = "<YOUR_D1_DATABASE_ID>" # The ID output by the create command
    ```

3.  **Run Database Migrations:**
    The project includes a migration file to set up the necessary `server_status` table.
    -   **For Local Development:** Update the `<YOUR_DB_NAME>` placeholder in the `package.json` script `migrate:local` if you haven't already.
        ```bash
        npm run migrate:local
        # Example: wrangler d1 execute server-monitor-db --local --file=./migrations/0001_create_server_status_table.sql
        ```
    -   **For Production:** Update the `<YOUR_DB_NAME>` placeholder in the `package.json` script `migrate:prod`.
        ```bash
        npm run migrate:prod
        # Example: wrangler d1 execute server-monitor-db --file=./migrations/0001_create_server_status_table.sql
        ```

## Environment Variable Configuration

The worker relies on environment variables for its configuration.

**For Local Development (`wrangler dev`):**

Create a `.dev.vars` file in the root of your project. **Do not commit this file to version control.** Add it to your `.gitignore`.

```ini
# .dev.vars
SERVERS="server1.example.com,server2.example.com"
TELEGRAM_BOT_TOKEN="your_telegram_bot_token_here"
TELEGRAM_CHAT_ID="your_telegram_chat_id_here"
ACCESS_TOKEN="a_strong_random_bearer_token_here"
```

**For Production (Deployed Worker):**

Set these as secrets in your Cloudflare Worker dashboard or using Wrangler CLI:

```bash
wrangler secret put SERVERS
# Paste comma-separated server hostnames

wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your Telegram bot token

wrangler secret put TELEGRAM_CHAT_ID
# Paste your Telegram chat ID

wrangler secret put ACCESS_TOKEN
# Paste your secure access token
```

## Running Locally

To run the worker locally for development and testing:

```bash
npm run dev
# or
wrangler dev --local
```

Wrangler will typically start the worker on `http://localhost:8787`. It will also simulate cron triggers for the scheduled task.

## Deployment

To deploy the worker to your Cloudflare account:

```bash
npm run deploy
# or
wrangler deploy
```

## Using the `/hello` Endpoint

Servers should be configured to send a POST request to the `/hello` endpoint of your deployed worker (or local instance) to indicate they are alive.

-   **Method:** `POST`
-   **URL:** `https://your-worker-url.your-account.workers.dev/hello?server_name=<your_server_hostname>`
    (Replace `<your_server_hostname>` with the actual hostname of the server sending the ping, e.g., `server1.example.com`)
-   **Headers:**
    -   `Authorization: Bearer <your_access_token>` (Replace `<your_access_token>` with the one you configured)

**Example using `curl`:**

```bash
curl -X POST \
  -H "Authorization: Bearer your_access_token" \
  "https://your-worker-url.your-account.workers.dev/hello?server_name=server1.example.com"
```

Or for local testing:

```bash
curl -X POST \
  -H "Authorization: Bearer your_access_token" \
  "http://localhost:8787/hello?server_name=server1.example.com"
```

## Scheduled Task

-   The worker has a scheduled task defined in `wrangler.toml` (e.g., `cron = "*/1 * * * *"` to run every minute).
-   This task iterates through the servers listed in the `SERVERS` environment variable.
-   If a server is currently marked as 'up' but its `last_hello_timestamp` is older than a defined threshold (currently 70 seconds), it will be marked as 'down', and a Telegram notification will be sent.
-   If a server is listed in the `SERVERS` environment variable but is not found in the D1 database, it will be added with a 'down' status, and a notification will be sent.

This ensures that you are alerted even if a server completely fails and stops sending pings.

## Telegram Bot Interface

Beyond automatic notifications, the worker also provides a Telegram bot interface for on-demand server status checks.

-   **Endpoint:** `/tgbot`
-   **Method:** `POST` (This endpoint is designed to be used as a webhook for your Telegram bot)

### Setup

1.  **Configure your Telegram Bot:**
    -   Talk to the [BotFather](https://t.me/botfather) on Telegram.
    -   Use the `/setwebhook` command register your bot webhook. `curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -d "url=<YOUR_WORKER_URL>/tgbot"`
    -   Register menu for your bot:
    ```
    curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{
        "commands": [
            {"command": "status", "description": "Get Server Status"}
        ],
        "scope": {"type": "default"},
        "language_code": "en"
    }' \
    https://api.telegram.org/bot<BOT_TOKEN>/setMyCommands
    ```
    -   Ensure your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables are correctly set for the worker. The bot will only respond to commands from the configured `TELEGRAM_CHAT_ID`.

### Commands

-   **/status**: Send this command to your bot. The bot will reply with a list of all monitored servers (from the `SERVERS` environment variable) and their current status, including:
    -   Current state ('UP', 'DOWN', or 'UP (Stale)' if pings are recent but older than the alert threshold).
    -   Timestamp of the last received ping.
    -   Timestamp of the last state change.

    Example interaction:
    ```
    You: /status

    Bot: *Server Status Report:*

          *server1.example.com*
          ✅ Status: *UP*
            Last Ping: [Date & Time]
            Last State Change: [Date & Time]

          *server2.example.com*
          ❗ Status: *DOWN*
            Last Ping: [Date & Time]
            Last State Change: [Date & Time]
    ```

This allows you to quickly check the health of all your servers directly from Telegram.
