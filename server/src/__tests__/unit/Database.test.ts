/**
 * Database Unit Tests
 *
 * Tests the DatabaseAdapter class including initialization, migrations,
 * prepared statements, transactions, and the singleton lifecycle
 * managed by getDatabase/closeDatabase.
 *
 * All tests use in-memory SQLite (`:memory:`) with WAL mode disabled
 * to avoid filesystem side effects.
 */

import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DatabaseAdapter,
  getDatabase,
  closeDatabase,
} from "../../storage/Database.js";

// Suppress console.log noise from Database initialization messages
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("DatabaseAdapter", () => {
  let adapter: DatabaseAdapter;

  afterEach(() => {
    // Ensure we clean up any adapter we created
    try {
      adapter?.close();
    } catch {
      // Ignore errors from already-closed adapters
    }
  });

  describe("constructor", () => {
    it("should create an adapter without initializing the database", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      expect(adapter.isInitialized()).toBe(false);
    });

    it("should default walMode to true when not specified", () => {
      adapter = new DatabaseAdapter({ path: ":memory:" });

      // We cannot inspect the config directly, but we can verify
      // the adapter was constructed without error
      expect(adapter.isInitialized()).toBe(false);
    });
  });

  describe("initialize()", () => {
    it("should create all schema tables on first call", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("migrations");
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("sessions");
      expect(tableNames).toContain("transcripts");
      expect(tableNames).toContain("conversation_summaries");
      expect(tableNames).toContain("audit_events");
    });

    it("should record all migrations as applied", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();
      const migrations = db
        .prepare("SELECT name FROM migrations ORDER BY id")
        .all() as Array<{ name: string }>;

      const migrationNames = migrations.map((m) => m.name);

      expect(migrationNames).toEqual([
        "001_create_users",
        "002_create_sessions",
        "003_create_transcripts",
        "004_create_summaries",
        "005_create_audit_events",
      ]);
    });

    it("should be idempotent when called multiple times", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();
      adapter.initialize(); // Second call should be a no-op

      expect(adapter.isInitialized()).toBe(true);

      // Verify tables exist and there are no duplicate migrations
      const db = adapter.getDb();
      const migrationCount = db
        .prepare("SELECT COUNT(*) as count FROM migrations")
        .get() as { count: number };

      expect(migrationCount.count).toBe(5);
    });

    it("should enable foreign keys", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();
      const fkStatus = db.pragma("foreign_keys") as Array<{
        foreign_keys: number;
      }>;

      expect(fkStatus[0].foreign_keys).toBe(1);
    });

    it("should set initialized flag to true", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      expect(adapter.isInitialized()).toBe(false);

      adapter.initialize();

      expect(adapter.isInitialized()).toBe(true);
    });
  });

  describe("getDb()", () => {
    it("should throw when database is not initialized", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      expect(() => adapter.getDb()).toThrow(
        "Database not initialized. Call initialize() first.",
      );
    });

    it("should return the database instance when initialized", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();

      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe("function");
      expect(typeof db.exec).toBe("function");
    });
  });

  describe("prepare()", () => {
    it("should return a prepared statement", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const stmt = adapter.prepare("SELECT 1 as value");
      const result = stmt.get() as { value: number };

      expect(result.value).toBe(1);
    });

    it("should throw when database is not initialized", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      expect(() => adapter.prepare("SELECT 1")).toThrow(
        "Database not initialized. Call initialize() first.",
      );
    });
  });

  describe("runSql()", () => {
    it("should execute raw SQL statements", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      adapter.runSql(
        "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
      );

      const tables = adapter
        .getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'",
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe("test_table");
    });
  });

  describe("close()", () => {
    it("should set initialized to false", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      expect(adapter.isInitialized()).toBe(true);

      adapter.close();

      expect(adapter.isInitialized()).toBe(false);
    });

    it("should be safe to call when not initialized", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      // Should not throw
      expect(() => adapter.close()).not.toThrow();
    });

    it("should be safe to call multiple times", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      adapter.close();

      // Second close should not throw
      expect(() => adapter.close()).not.toThrow();
    });
  });

  describe("isInitialized()", () => {
    it("should return false before initialization", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });

      expect(adapter.isInitialized()).toBe(false);
    });

    it("should return true after initialization", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      expect(adapter.isInitialized()).toBe(true);
    });

    it("should return false after close", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();
      adapter.close();

      expect(adapter.isInitialized()).toBe(false);
    });
  });

  describe("transaction()", () => {
    it("should execute operations atomically", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();

      // Insert a user and session inside a transaction
      adapter.transaction(() => {
        db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
          "u1",
          "fp-1",
        );
        db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
          "s1",
          "u1",
        );
      });

      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get("u1") as { id: string };
      const session = db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get("s1") as { id: string };

      expect(user.id).toBe("u1");
      expect(session.id).toBe("s1");
    });

    it("should roll back all operations on error", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const db = adapter.getDb();

      expect(() => {
        adapter.transaction(() => {
          db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
            "u2",
            "fp-2",
          );
          // This will fail due to FK constraint (non-existent user_id)
          db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
            "s2",
            "non-existent-user",
          );
        });
      }).toThrow();

      // The user insert should have been rolled back
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get("u2");
      expect(user).toBeUndefined();
    });

    it("should return the value from the transaction function", () => {
      adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
      adapter.initialize();

      const result = adapter.transaction(() => {
        return 42;
      });

      expect(result).toBe(42);
    });
  });
});

  describe("branch coverage — uncovered paths", () => {
    let branchAdapter: DatabaseAdapter;

    afterEach(() => {
      try { branchAdapter?.close(); } catch { /* ignore */ }
    });

    it("enables WAL mode when walMode is true — line 59 branch (requires real file)", () => {
      // WAL mode requires a real file — :memory: always uses "memory" journal mode.
      // All other tests use walMode:false; this covers the `if (this.config.walMode)` branch.
      const base = mkdtempSync(join(tmpdir(), "vjj-wal-"));
      const dbPath = join(base, "wal.db");
      try {
        branchAdapter = new DatabaseAdapter({ path: dbPath, walMode: true });
        branchAdapter.initialize();
        const walMode = branchAdapter.getDb().pragma("journal_mode") as Array<{
          journal_mode: string;
        }>;
        expect(walMode[0].journal_mode).toBe("wal");
      } finally {
        try { branchAdapter?.close(); } catch { /* ignore */ }
        rmSync(base, { recursive: true, force: true });
      }
    });

    it("verbose:true passes console.log to better-sqlite3 (covers ternary line 54)", () => {
      // Covers `this.config.verbose ? console.log : undefined` true branch
      branchAdapter = new DatabaseAdapter({ path: ":memory:", walMode: false, verbose: true });
      expect(() => branchAdapter.initialize()).not.toThrow();
      expect(branchAdapter.isInitialized()).toBe(true);
    });

    it("creates parent directory when it does not exist (line 49 mkdirSync branch)", () => {
      // Use a real tmpdir with a new sub-directory so existsSync returns false
      const base = mkdtempSync(join(tmpdir(), "vjj-db-test-"));
      const newSubDir = join(base, "nested", "subdir");
      const dbPath = join(newSubDir, "test.db");

      try {
        branchAdapter = new DatabaseAdapter({ path: dbPath, walMode: false });
        branchAdapter.initialize();
        expect(branchAdapter.isInitialized()).toBe(true);
      } finally {
        try { branchAdapter?.close(); } catch { /* ignore */ }
        rmSync(base, { recursive: true, force: true });
      }
    });

    it("re-opening an existing DB file invokes .map() callback on migration rows — line 95", () => {
      // Line 95 `.map((row: any) => row.name)` is only invoked when the SELECT
      // returns at least one row. On first open, migrations table is empty.
      // Fix: open a real file, initialize (applies 5 migrations), close, re-open
      // with a NEW adapter. Second adapter's runMigrations() sees all 5 rows,
      // invokes the .map() callback, and skips all already-applied migrations.
      const base = mkdtempSync(join(tmpdir(), "vjj-reopen-"));
      const dbPath = join(base, "reopen.db");
      let first: DatabaseAdapter | undefined;
      try {
        first = new DatabaseAdapter({ path: dbPath, walMode: false });
        first.initialize();
        first.close();

        branchAdapter = new DatabaseAdapter({ path: dbPath, walMode: false });
        branchAdapter.initialize(); // runMigrations → SELECT returns 5 rows → .map() invoked
        expect(branchAdapter.isInitialized()).toBe(true);

        const db = branchAdapter.getDb();
        const count = (db.prepare("SELECT COUNT(*) as c FROM migrations").get() as { c: number }).c;
        expect(count).toBe(5); // no duplicate migrations
      } finally {
        try { first?.close(); } catch { /* ignore */ }
        rmSync(base, { recursive: true, force: true });
      }
    });
  });

describe("Singleton lifecycle", () => {
  afterEach(() => {
    closeDatabase();
  });

  describe("getDatabase()", () => {
    it("should create and initialize a singleton instance", () => {
      const db = getDatabase({ path: ":memory:", walMode: false });

      expect(db).toBeInstanceOf(DatabaseAdapter);
      expect(db.isInitialized()).toBe(true);
    });

    it("should return the same instance on subsequent calls", () => {
      const db1 = getDatabase({ path: ":memory:", walMode: false });
      const db2 = getDatabase();

      expect(db1).toBe(db2);
    });

    it("should ignore config on subsequent calls when singleton exists", () => {
      const db1 = getDatabase({ path: ":memory:", walMode: false });
      // This call should return the same instance, ignoring new config
      const db2 = getDatabase({ path: ":memory:", walMode: false });

      expect(db1).toBe(db2);
    });
  });

  describe("closeDatabase()", () => {
    it("should reset the singleton instance", () => {
      const db1 = getDatabase({ path: ":memory:", walMode: false });

      closeDatabase();

      const db2 = getDatabase({ path: ":memory:", walMode: false });

      // After reset, getDatabase should create a new instance
      expect(db2).not.toBe(db1);
    });

    it("should be safe to call when no singleton exists", () => {
      // Should not throw even when no instance exists
      expect(() => closeDatabase()).not.toThrow();
    });

    it("should close the underlying database", () => {
      const db = getDatabase({ path: ":memory:", walMode: false });

      expect(db.isInitialized()).toBe(true);

      closeDatabase();

      expect(db.isInitialized()).toBe(false);
    });
  });
});

describe("Schema integrity", () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = new DatabaseAdapter({ path: ":memory:", walMode: false });
    adapter.initialize();
  });

  afterEach(() => {
    adapter.close();
  });

  it("should enforce foreign key constraint on sessions.user_id", () => {
    const db = adapter.getDb();

    expect(() => {
      db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
        "s1",
        "non-existent-user",
      );
    }).toThrow();
  });

  it("should enforce foreign key constraint on transcripts.session_id", () => {
    const db = adapter.getDb();

    expect(() => {
      db.prepare(
        "INSERT INTO transcripts (session_id, role, content, timestamp_ms) VALUES (?, ?, ?, ?)",
      ).run("non-existent-session", "user", "hello", Date.now());
    }).toThrow();
  });

  it("should enforce unique fingerprint on users", () => {
    const db = adapter.getDb();

    db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
      "u1",
      "fp-unique",
    );

    expect(() => {
      db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
        "u2",
        "fp-unique",
      );
    }).toThrow();
  });

  it("should enforce role CHECK constraint on transcripts", () => {
    const db = adapter.getDb();

    // Create parent row first
    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    expect(() => {
      db.prepare(
        "INSERT INTO transcripts (session_id, role, content, timestamp_ms) VALUES (?, ?, ?, ?)",
      ).run("s1", "invalid_role", "hello", Date.now());
    }).toThrow();
  });

  it("should enforce unique event_id on audit_events", () => {
    const db = adapter.getDb();

    db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s1");

    db.prepare(
      "INSERT INTO audit_events (event_id, session_id, event_type, source, timestamp_ms) VALUES (?, ?, ?, ?, ?)",
    ).run("evt-1", "s1", "test", "unit-test", Date.now());

    expect(() => {
      db.prepare(
        "INSERT INTO audit_events (event_id, session_id, event_type, source, timestamp_ms) VALUES (?, ?, ?, ?, ?)",
      ).run("evt-1", "s1", "test", "unit-test", Date.now());
    }).toThrow();
  });

  it("should allow nullable user_id on sessions", () => {
    const db = adapter.getDb();

    // Should succeed with null user_id
    expect(() => {
      db.prepare("INSERT INTO sessions (id) VALUES (?)").run("s-anon");
    }).not.toThrow();

    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get("s-anon") as { user_id: string | null };

    expect(session.user_id).toBeNull();
  });
});

describe("getDatabase() singleton — branch coverage", () => {
  afterEach(() => {
    closeDatabase();
    delete process.env.DATABASE_PATH;
  });

  it("uses process.env.DATABASE_PATH when no config.path is given (L273 middle branch)", () => {
    // Set env var to an in-memory path — better-sqlite3 treats ":memory:" as in-memory
    process.env.DATABASE_PATH = ":memory:";

    const db = getDatabase(); // no config at all → falls through to process.env.DATABASE_PATH
    expect(db).toBeInstanceOf(DatabaseAdapter);
    expect(db.isInitialized()).toBe(true);
  });

  it("defaults walMode to true when config.walMode is not provided (L274 ?? true branch)", () => {
    // Pass a config with only path — walMode is absent so ?? true fires
    // :memory: doesn't actually use WAL but the branch is taken; verify no error
    const db = getDatabase({ path: ":memory:" });
    expect(db).toBeInstanceOf(DatabaseAdapter);
    expect(db.isInitialized()).toBe(true);
  });
});
