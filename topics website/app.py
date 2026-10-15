
import random
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

DB_PATH = Path(__file__).with_name("wheel.db")
app = Flask(__name__, static_folder="static", static_url_path="/static")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS presenters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
        """)


def clean(value):
    return " ".join((value or "").split())[:80]


def register(table):
    def list_items():
        with db() as conn:
            rows = conn.execute(
                f"SELECT id, name FROM {table} ORDER BY id"
            ).fetchall()
        return jsonify([dict(row) for row in rows])

    def add_item():
        data = request.get_json(silent=True) or {}
        name = clean(data.get("name"))

        if not name:
            return jsonify(error="Enter a name first."), 400

        try:
            with db() as conn:
                cur = conn.execute(
                    f"INSERT INTO {table} (name) VALUES (?)",
                    (name,)
                )
                item_id = cur.lastrowid
        except sqlite3.IntegrityError:
            return jsonify(error=f"'{name}' is already on the list."), 409

        return jsonify(id=item_id, name=name), 201

    def delete_item(item_id):
        with db() as conn:
            conn.execute(
                f"DELETE FROM {table} WHERE id = ?",
                (item_id,)
            )
        return "", 204

    app.add_url_rule(
        f"/api/{table}", f"list_{table}", list_items
    )
    app.add_url_rule(
        f"/api/{table}", f"add_{table}", add_item,
        methods=["POST"]
    )
    app.add_url_rule(
        f"/api/{table}/<int:item_id>", f"del_{table}",
        delete_item, methods=["DELETE"]
    )


register("topics")
register("presenters")


@app.post("/api/topics/spin")
def spin_topic():
    """Select one random topic and permanently remove it."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name FROM topics"
        ).fetchall()

        if not rows:
            return jsonify(error="No topics left. Add some first."), 400

        winner = random.choice(rows)

        conn.execute(
            "DELETE FROM topics WHERE id = ?",
            (winner["id"],)
        )

        result = dict(winner)

    return jsonify(result)


@app.post("/api/presenters/spin")
def spin_presenter():
    """Select a random presenter without deleting them by default."""
    data = request.get_json(silent=True) or {}
    remove = data.get("remove", False) is True

    with db() as conn:
        rows = conn.execute(
            "SELECT id, name FROM presenters"
        ).fetchall()

        if not rows:
            return jsonify(error="No presenters yet. Add some first."), 400

        winner = random.choice(rows)

        if remove:
            conn.execute(
                "DELETE FROM presenters WHERE id = ?",
                (winner["id"],)
            )

        result = dict(winner)

    return jsonify(result)


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
