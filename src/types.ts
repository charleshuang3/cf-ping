export interface Env {
  // Environment variables
  SERVERS: string; // Comma-separated list of server hostnames
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ACCESS_TOKEN: string;

  // D1 Binding
  DB: D1Database;
}

export interface ServerStatus {
  server_name: string;
  last_hello_timestamp: number; // Unix timestamp (seconds)
  last_state: 'up' | 'down';
  last_state_change_timestamp: number; // Unix timestamp (seconds)
}
