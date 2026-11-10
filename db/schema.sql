-- Ekakarsa Point - skema database (PostgreSQL)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','pembina','ketua','calon_ketua')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS divisions (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kelas       TEXT NOT NULL DEFAULT '',
  division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  jabatan     TEXT NOT NULL DEFAULT 'Anggota',
  points      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_name_kelas_uq ON members (lower(name), lower(kelas));

CREATE TABLE IF NOT EXISTS programs (
  id          SERIAL PRIMARY KEY,
  division_id INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS history (
  id            SERIAL PRIMARY KEY,
  action        TEXT NOT NULL,
  description   TEXT NOT NULL,
  member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  member_name   TEXT,
  delta         INTEGER,
  points_before INTEGER,
  points_after  INTEGER,
  actor_name    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_created_idx ON history (created_at DESC);

CREATE TABLE IF NOT EXISTS violations (
  id            SERIAL PRIMARY KEY,
  member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  member_name   TEXT NOT NULL,
  member_kelas  TEXT NOT NULL DEFAULT '',
  member_division TEXT,
  jenis         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  points        INTEGER NOT NULL CHECK (points > 0),
  incident_date DATE NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  letter_number TEXT UNIQUE,
  reported_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS violation_witnesses (
  id           SERIAL PRIMARY KEY,
  violation_id INTEGER NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  info         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS violation_approvals (
  id           SERIAL PRIMARY KEY,
  violation_id INTEGER NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT NOT NULL,
  user_role    TEXT NOT NULL,
  decision     TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (violation_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ====== Manajemen barang (inventaris OSIS) ======
CREATE TABLE IF NOT EXISTS items (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit       TEXT NOT NULL DEFAULT 'buah',
  condition  TEXT NOT NULL DEFAULT 'baik' CHECK (condition IN ('baik','rusak_ringan','rusak_berat')),
  location   TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_loans (
  id              SERIAL PRIMARY KEY,
  item_id         INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name       TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
  borrower_name   TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT '',
  loan_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'dipinjam' CHECK (status IN ('dipinjam','dikembalikan')),
  returned_at     TIMESTAMPTZ,
  return_condition TEXT CHECK (return_condition IN ('baik','rusak_ringan','rusak_berat')),
  return_note     TEXT NOT NULL DEFAULT '',
  recorded_by     TEXT NOT NULL,
  returned_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_loans_status_idx ON item_loans (status, created_at DESC);

-- ====== Sistem piket ======
CREATE TABLE IF NOT EXISTS piket_schedule (
  id         SERIAL PRIMARY KEY,
  day        SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 6),
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  task       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (day, member_id)
);

CREATE TABLE IF NOT EXISTS piket_attendance (
  id          SERIAL PRIMARY KEY,
  date        DATE NOT NULL,
  member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
  note        TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, member_id)
);
CREATE INDEX IF NOT EXISTS piket_attendance_date_idx ON piket_attendance (date);
