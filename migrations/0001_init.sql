CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 1000,
  pro_until INTEGER NOT NULL DEFAULT 0,
  cosmetics TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,            -- bot | hotseat | online
  verified INTEGER NOT NULL,     -- 1 when the result was decided by the server
  opponent TEXT NOT NULL,
  result TEXT NOT NULL,          -- win | loss | draw
  rounds_won INTEGER NOT NULL,
  rounds_lost INTEGER NOT NULL,
  duration_sec REAL NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}',
  rating_delta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX matches_user ON matches(user_id, created_at DESC);

CREATE TABLE challenges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  best REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  amount INTEGER NOT NULL,
  mode TEXT NOT NULL,            -- always 'test' in this prototype
  card_last4 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- lobby | match | done
  team_size INTEGER NOT NULL,
  players TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
