import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath('userData'), 'radio-sankt.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schema creation wrapped in a transaction to avoid partial state on crash
  const initSchema = db.transaction(() => {
    db!.exec(`
      CREATE TABLE IF NOT EXISTS jingles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        filePath TEXT NOT NULL,
        durationMs INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db!.exec(`
      CREATE TABLE IF NOT EXISTS ads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        filePath TEXT NOT NULL,
        durationMs INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db!.exec(`
      CREATE TABLE IF NOT EXISTS automation_playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db!.exec(`
      CREATE TABLE IF NOT EXISTS program_weekly_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlistId INTEGER NOT NULL,
        dayOfWeek INTEGER NOT NULL,
        startMinute INTEGER NOT NULL,
        durationMinutes INTEGER NOT NULL DEFAULT 60,
        maxDurationMs INTEGER,
        label TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (playlistId) REFERENCES automation_playlists(id) ON DELETE CASCADE
      )
    `);

    db!.exec(`CREATE INDEX IF NOT EXISTS idx_weekly_dow_start ON program_weekly_slots(dayOfWeek, startMinute)`);
  });
  initSchema();

  // Schema versioning for future migrations
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  const migrations: Array<() => void> = [
    // v1: initial schema (tables already created above via IF NOT EXISTS)
    () => {},
    // v2: per-jingle crossfade time (ramp music back up before jingle ends)
    () => {
      db!.exec(`ALTER TABLE jingles ADD COLUMN crossfadeMs INTEGER NOT NULL DEFAULT 0`);
      db!.exec(`ALTER TABLE ads ADD COLUMN crossfadeMs INTEGER NOT NULL DEFAULT 0`);
    },
  ];

  if (currentVersion < migrations.length) {
    const runMigrations = db.transaction(() => {
      for (let i = currentVersion; i < migrations.length; i++) {
        migrations[i]();
      }
      if (currentVersion === 0) {
        db!.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migrations.length);
      } else {
        db!.prepare('UPDATE schema_version SET version = ?').run(migrations.length);
      }
    });
    runMigrations();
  }

  return db;
}

export interface JingleRow {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
  crossfadeMs: number;
  createdAt: string;
}

export function saveJingle(name: string, filePath: string, durationMs: number): JingleRow {
  const db = getDatabase();
  const stmt = db.prepare('INSERT INTO jingles (name, filePath, durationMs) VALUES (?, ?, ?)');
  const result = stmt.run(name, filePath, durationMs);
  return db.prepare('SELECT * FROM jingles WHERE id = ?').get(result.lastInsertRowid) as JingleRow;
}

export function getJingles(): JingleRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM jingles ORDER BY createdAt DESC').all() as JingleRow[];
}

export function deleteJingle(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM jingles WHERE id = ?').run(id);
}

export function renameJingle(id: number, name: string): void {
  const db = getDatabase();
  db.prepare('UPDATE jingles SET name = ? WHERE id = ?').run(name, id);
}

export function updateJingleCrossfade(id: number, crossfadeMs: number): void {
  const db = getDatabase();
  db.prepare('UPDATE jingles SET crossfadeMs = ? WHERE id = ?').run(crossfadeMs, id);
}

export interface AdRow {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
  crossfadeMs: number;
  createdAt: string;
}

export function saveAd(name: string, filePath: string, durationMs: number): AdRow {
  const db = getDatabase();
  const stmt = db.prepare('INSERT INTO ads (name, filePath, durationMs) VALUES (?, ?, ?)');
  const result = stmt.run(name, filePath, durationMs);
  return db.prepare('SELECT * FROM ads WHERE id = ?').get(result.lastInsertRowid) as AdRow;
}

export function getAds(): AdRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM ads ORDER BY createdAt DESC').all() as AdRow[];
}

export function deleteAd(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM ads WHERE id = ?').run(id);
}

export function renameAd(id: number, name: string): void {
  const db = getDatabase();
  db.prepare('UPDATE ads SET name = ? WHERE id = ?').run(name, id);
}

export function updateAdCrossfade(id: number, crossfadeMs: number): void {
  const db = getDatabase();
  db.prepare('UPDATE ads SET crossfadeMs = ? WHERE id = ?').run(crossfadeMs, id);
}

// ── Automation Playlists ──────────────────────────────────────────────

export interface PlaylistRow {
  id: number;
  name: string;
  steps: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistSummary {
  id: number;
  name: string;
  stepCount: number;
  updatedAt: string;
}

export function savePlaylist(name: string, steps: string): PlaylistRow {
  const db = getDatabase();
  const stmt = db.prepare('INSERT INTO automation_playlists (name, steps) VALUES (?, ?)');
  const result = stmt.run(name, steps);
  return db.prepare('SELECT * FROM automation_playlists WHERE id = ?').get(result.lastInsertRowid) as PlaylistRow;
}

export function updatePlaylist(id: number, name: string, steps: string): void {
  const db = getDatabase();
  db.prepare("UPDATE automation_playlists SET name = ?, steps = ?, updatedAt = datetime('now') WHERE id = ?").run(name, steps, id);
}

export function loadPlaylist(id: number): PlaylistRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM automation_playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
}

export function listPlaylists(): PlaylistSummary[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT id, name, steps, updatedAt FROM automation_playlists ORDER BY updatedAt DESC').all() as PlaylistRow[];
  return rows.map((r) => {
    let stepCount = 0;
    try {
      stepCount = JSON.parse(r.steps).length;
    } catch {
      // corrupted steps JSON — treat as empty
    }
    return {
      id: r.id,
      name: r.name,
      stepCount,
      updatedAt: r.updatedAt,
    };
  });
}

export function deletePlaylist(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM automation_playlists WHERE id = ?').run(id);
}

// ── Weekly program slots (recurring) ───────────────────────────────────

export interface WeeklySlotRow {
  id: number;
  playlistId: number;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  maxDurationMs: number | null;
  label: string | null;
  createdAt: string;
}

export function listWeeklySlots(): WeeklySlotRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM program_weekly_slots ORDER BY dayOfWeek, startMinute').all() as WeeklySlotRow[];
}

export function addWeeklySlot(
  playlistId: number,
  dayOfWeek: number,
  startMinute: number,
  durationMinutes: number,
  maxDurationMs: number | null,
  label: string | null,
): WeeklySlotRow {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT INTO program_weekly_slots (playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const result = stmt.run(playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label);
  return db.prepare('SELECT * FROM program_weekly_slots WHERE id = ?').get(result.lastInsertRowid) as WeeklySlotRow;
}

export function updateWeeklySlot(
  id: number,
  playlistId: number,
  dayOfWeek: number,
  startMinute: number,
  durationMinutes: number,
  maxDurationMs: number | null,
  label: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE program_weekly_slots SET playlistId = ?, dayOfWeek = ?, startMinute = ?, durationMinutes = ?, maxDurationMs = ?, label = ? WHERE id = ?',
  ).run(playlistId, dayOfWeek, startMinute, durationMinutes, maxDurationMs, label, id);
}

export function deleteWeeklySlot(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM program_weekly_slots WHERE id = ?').run(id);
}
