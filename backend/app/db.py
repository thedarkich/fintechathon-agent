from pathlib import Path

from sqlalchemy import event
from sqlmodel import SQLModel, create_engine

import app.models  # noqa: F401  (registers every table)


def make_engine(database: Path):
    database.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        "sqlite:///" + str(database),
        connect_args={"check_same_thread": False, "timeout": 10},
        hide_parameters=True,
    )

    @event.listens_for(engine, "connect")
    def pragmas(connection, _):
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    add_missing_columns(engine)
    return engine


def add_missing_columns(engine) -> None:
    """create_all makes new tables but never changes existing ones, so a column added to a model later
    is added here. Only optional columns: anything else needs a real migration."""
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            present = {row[1] for row in conn.exec_driver_sql(f'PRAGMA table_info("{table.name}")')}
            for column in table.columns:
                if column.name not in present and column.nullable:
                    kind = column.type.compile(dialect=engine.dialect)
                    conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {kind}')
