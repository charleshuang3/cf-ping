-- Create the server_status table
-- To apply this migration, use the following Wrangler command:
-- wrangler d1 execute <YOUR_DB_NAME> --file=./migrations/0001_create_server_status_table.sql

CREATE TABLE IF NOT EXISTS server_status (
  server_name TEXT PRIMARY KEY,
  last_hello_timestamp INTEGER DEFAULT 0,
  last_state TEXT CHECK(last_state IN ('up', 'down')) DEFAULT 'down',
  last_state_change_timestamp INTEGER DEFAULT 0
);
