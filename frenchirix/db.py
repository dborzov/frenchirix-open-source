"""Opening the project database, creating its schema and migrating older files."""

from __future__ import annotations

import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "assets"
DB_PATH = ASSETS_DIR / "db.sqlite"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SCHEMA_VERSION = "6"


def _schema_statements(*names: str) -> str:
    """The CREATE statements for the named tables and views, taken from schema.sql.

    Migrations reuse the text of schema.sql so that a migrated database and a fresh one
    cannot drift apart. A statement ends at its first ';', so a comment inside a CREATE
    statement must not contain one.
    """
    text = SCHEMA_PATH.read_text(encoding="utf-8")
    chunks = []
    for name in names:
        for kind in ("TABLE", "VIEW"):
            start = text.find(f"CREATE {kind} {name} ")
            if start != -1:
                chunks.append(text[start : text.index(";", start) + 1])
                break
        else:
            raise KeyError(name)
    return "\n".join(chunks)


def _migrate_4_to_5(conn: sqlite3.Connection) -> None:
    """Version 5 renames the table `explanations` to `notes`, keeping its rows."""
    conn.execute("BEGIN")
    conn.execute(_schema_statements("notes"))
    conn.execute("INSERT INTO notes SELECT * FROM explanations")
    conn.execute("DROP TABLE explanations")


def _migrate_5_to_6(conn: sqlite3.Connection) -> None:
    """Version 6 adds `review_marks` and drops `scenes.status` and `scenes.note`, the
    columns of the retired keep/reject curation (every scene counts as accepted)."""
    conn.execute("BEGIN")
    conn.execute(_schema_statements("review_marks"))
    conn.execute("ALTER TABLE scenes DROP COLUMN status")
    conn.execute("ALTER TABLE scenes DROP COLUMN note")


# Only versions 4 and 5 are migrated: no older database exists any more.
MIGRATIONS = {"4": _migrate_4_to_5, "5": _migrate_5_to_6}


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the database at `path`, creating or migrating its schema as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    has_schema = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'"
    ).fetchone()
    if not has_schema:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?)", (SCHEMA_VERSION,)
        )
        conn.commit()
        return conn
    version = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0]
    while version != SCHEMA_VERSION:
        if version not in MIGRATIONS:
            raise RuntimeError(f"{path}: schema version {version} cannot be migrated "
                               f"to {SCHEMA_VERSION}")
        MIGRATIONS[version](conn)
        version = str(int(version) + 1)
        conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", (version,))
        conn.commit()
    return conn
