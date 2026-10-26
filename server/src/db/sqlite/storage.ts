import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { Database as SqlDatabase } from 'sql.js';

export interface SqliteStorageOptions {
  dbPath: string;
  autoPersist?: boolean;
}

export class SqliteStorage {
  private db: SqlDatabase;
  private dbPath: string;
  private autoPersist: boolean;
  private isClosed = false;

  private constructor(db: SqlDatabase, dbPath: string, autoPersist = true) {
    this.db = db;
    this.dbPath = dbPath;
    this.autoPersist = autoPersist;
  }

  /**
   * Factory method to initialize sql.js WASM and open or create the SQLite database.
   */
  static async open(options: SqliteStorageOptions): Promise<SqliteStorage> {
    const { dbPath, autoPersist = true } = options;
    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let wasmBinaryPath: string | undefined;
    try {
      wasmBinaryPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    } catch {
      const candidates = [
        path.join(__dirname, 'sql-wasm.wasm'),
        path.join(__dirname, '..', 'sql-wasm.wasm'),
        path.join((process as any).resourcesPath || '', 'server', 'dist', 'sql-wasm.wasm'),
      ];
      wasmBinaryPath = candidates.find((p) => p && fs.existsSync(p));
    }

    const SQL = await initSqlJs({
      locateFile: () => wasmBinaryPath || 'sql-wasm.wasm',
    });

    let db: SqlDatabase;
    if (fs.existsSync(resolvedPath)) {
      const buffer = fs.readFileSync(resolvedPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
      // Initialize file on disk immediately
      const initialData = Buffer.from(db.export());
      fs.writeFileSync(resolvedPath, initialData);
    }

    return new SqliteStorage(db, resolvedPath, autoPersist);
  }

  /**
   * Get the absolute path to the database file.
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Get underlying sql.js Database instance.
   */
  getRawDb(): SqlDatabase {
    return this.db;
  }

  private inTransaction = false;

  /**
   * Atomically persist in-memory database to disk.
   */
  persist(): void {
    if (this.isClosed || this.inTransaction) return;
    const data = Buffer.from(this.db.export());
    const tmpPath = `${this.dbPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
    try {
      fs.writeFileSync(tmpPath, data);
      fs.renameSync(tmpPath, this.dbPath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Execute raw SQL statements (e.g. DDL / multiple statements).
   */
  exec(sql: string): void {
    this.db.exec(sql);
    if (this.autoPersist && !this.inTransaction) {
      this.persist();
    }
  }

  /**
   * Run a single parameterized statement (INSERT, UPDATE, DELETE).
   */
  run(sql: string, params: any[] = []): void {
    const stmt = this.db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
    if (this.autoPersist && !this.inTransaction) {
      this.persist();
    }
  }

  /**
   * Query multiple rows with mapped column keys.
   */
  query<T = any>(sql: string, params: any[] = []): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  /**
   * Query a single row, or null if not found.
   */
  queryOne<T = any>(sql: string, params: any[] = []): T | null {
    const rows = this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Run a series of statements inside a BEGIN ... COMMIT transaction with rollback on failure.
   */
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) {
      return fn();
    }

    this.inTransaction = true;
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      this.inTransaction = false;
      if (this.autoPersist) {
        this.persist();
      }
      return result;
    } catch (err) {
      this.inTransaction = false;
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }

  /**
   * Close the database and release memory.
   */
  close(): void {
    if (this.isClosed) return;
    this.persist();
    this.db.close();
    this.isClosed = true;
  }
}
