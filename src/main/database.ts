import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath('userData'), 'radio-sankt.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jingles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filePath TEXT NOT NULL,
      durationMs INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return db;
}

export interface JingleRow {
  id: number;
  name: string;
  filePath: string;
  durationMs: number;
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
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    stepCount: JSON.parse(r.steps).length,
    updatedAt: r.updatedAt,
  }));
}

export function deletePlaylist(id: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM automation_playlists WHERE id = ?').run(id);
}
