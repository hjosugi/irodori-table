import type { Dispatch, SetStateAction } from "react";
import {
  schemaDraftId,
  type SchemaColumnDraft,
  type SchemaDesignerDraft,
  type SchemaDesignerMode,
  type SchemaForeignKeyDraft,
  type SchemaIndexDraft,
} from "@/schema-designer";

export function SchemaDesignerDialog({
  draft,
  sqlPreview,
  onDraftChange,
  onClose,
  onCopySql,
  onPutSqlInEditor,
}: {
  draft: SchemaDesignerDraft;
  sqlPreview: string;
  onDraftChange: Dispatch<SetStateAction<SchemaDesignerDraft>>;
  onClose: () => void;
  onCopySql: () => void;
  onPutSqlInEditor: () => void;
}) {
  function updateColumn(id: string, patch: Partial<SchemaColumnDraft>) {
    onDraftChange((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    }));
  }

  function updateIndex(id: string, patch: Partial<SchemaIndexDraft>) {
    onDraftChange((current) => ({
      ...current,
      indexes: current.indexes.map((index) =>
        index.id === id ? { ...index, ...patch } : index,
      ),
    }));
  }

  function updateForeignKey(
    id: string,
    patch: Partial<SchemaForeignKeyDraft>,
  ) {
    onDraftChange((current) => ({
      ...current,
      foreignKeys: current.foreignKeys.map((foreignKey) =>
        foreignKey.id === id ? { ...foreignKey, ...patch } : foreignKey,
      ),
    }));
  }

  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="data-dialog schema-dialog"
        role="dialog"
        aria-label="Schema designer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <strong>Schema Designer</strong>
          <span>{draft.mode === "create" ? "CREATE TABLE" : "ALTER TABLE"}</span>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body schema-body">
          <div className="dialog-form-row schema-target">
            <label>
              <span>Mode</span>
              <select
                value={draft.mode}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    mode: event.currentTarget.value as SchemaDesignerMode,
                  }))
                }
              >
                <option value="create">Create</option>
                <option value="alter">Alter</option>
              </select>
            </label>
            <label>
              <span>Schema</span>
              <input
                value={draft.schema}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    schema: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Table</span>
              <input
                value={draft.table}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    table: event.currentTarget.value,
                  }))
                }
              />
            </label>
          </div>

          <section className="designer-section">
            <header>
              <strong>Columns</strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  onDraftChange((current) => ({
                    ...current,
                    columns: [
                      ...current.columns,
                      {
                        id: schemaDraftId("column"),
                        name: "",
                        dataType: "TEXT",
                        nullable: true,
                        primaryKey: false,
                        defaultValue: "",
                      },
                    ],
                  }))
                }
              >
                + Column
              </button>
            </header>
            <div className="designer-grid column-grid">
              {draft.columns.map((column) => {
                const locked = draft.mode === "alter" && column.existing;
                return (
                  <div
                    className={`designer-row${column.existing ? " is-existing" : ""}`}
                    key={column.id}
                  >
                    <input
                      aria-label="Column name"
                      value={column.name}
                      disabled={locked}
                      onChange={(event) =>
                        updateColumn(column.id, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Column type"
                      value={column.dataType}
                      disabled={locked}
                      onChange={(event) =>
                        updateColumn(column.id, {
                          dataType: event.currentTarget.value,
                        })
                      }
                    />
                    <label className="check-cell">
                      <input
                        type="checkbox"
                        checked={!column.nullable}
                        disabled={locked}
                        onChange={(event) =>
                          updateColumn(column.id, {
                            nullable: !event.currentTarget.checked,
                          })
                        }
                      />
                      <span>NN</span>
                    </label>
                    <label className="check-cell">
                      <input
                        type="checkbox"
                        checked={column.primaryKey}
                        disabled={locked}
                        onChange={(event) =>
                          updateColumn(column.id, {
                            primaryKey: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>PK</span>
                    </label>
                    <input
                      aria-label="Default value"
                      value={column.defaultValue}
                      disabled={locked}
                      placeholder="default"
                      onChange={(event) =>
                        updateColumn(column.id, {
                          defaultValue: event.currentTarget.value,
                        })
                      }
                    />
                    <button
                      className="mini-button"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        onDraftChange((current) => ({
                          ...current,
                          columns: current.columns.filter(
                            (item) => item.id !== column.id,
                          ),
                        }))
                      }
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="designer-section">
            <header>
              <strong>Indexes</strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  onDraftChange((current) => ({
                    ...current,
                    indexes: [
                      ...current.indexes,
                      {
                        id: schemaDraftId("index"),
                        name: "",
                        columns: "",
                        unique: false,
                      },
                    ],
                  }))
                }
              >
                + Index
              </button>
            </header>
            <div className="designer-grid index-grid">
              {draft.indexes.map((index) => {
                const locked = draft.mode === "alter" && index.existing;
                return (
                  <div
                    className={`designer-row${index.existing ? " is-existing" : ""}`}
                    key={index.id}
                  >
                    <input
                      aria-label="Index name"
                      value={index.name}
                      disabled={locked}
                      placeholder="auto name"
                      onChange={(event) =>
                        updateIndex(index.id, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Index columns"
                      value={index.columns}
                      disabled={locked}
                      placeholder="col_a, col_b"
                      onChange={(event) =>
                        updateIndex(index.id, {
                          columns: event.currentTarget.value,
                        })
                      }
                    />
                    <label className="check-cell">
                      <input
                        type="checkbox"
                        checked={index.unique}
                        disabled={locked}
                        onChange={(event) =>
                          updateIndex(index.id, {
                            unique: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>Unique</span>
                    </label>
                    <button
                      className="mini-button"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        onDraftChange((current) => ({
                          ...current,
                          indexes: current.indexes.filter(
                            (item) => item.id !== index.id,
                          ),
                        }))
                      }
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="designer-section">
            <header>
              <strong>Foreign Keys</strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  onDraftChange((current) => ({
                    ...current,
                    foreignKeys: [
                      ...current.foreignKeys,
                      {
                        id: schemaDraftId("fk"),
                        name: "",
                        columns: "",
                        referencesSchema: "",
                        referencesTable: "",
                        referencesColumns: "",
                        onDelete: "",
                      },
                    ],
                  }))
                }
              >
                + FK
              </button>
            </header>
            <div className="designer-grid fk-grid">
              {draft.foreignKeys.map((foreignKey) => {
                const locked = draft.mode === "alter" && foreignKey.existing;
                return (
                  <div
                    className={`designer-row${foreignKey.existing ? " is-existing" : ""}`}
                    key={foreignKey.id}
                  >
                    <input
                      aria-label="Foreign key name"
                      value={foreignKey.name}
                      disabled={locked}
                      placeholder="auto name"
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Foreign key columns"
                      value={foreignKey.columns}
                      disabled={locked}
                      placeholder="local cols"
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          columns: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Referenced schema"
                      value={foreignKey.referencesSchema}
                      disabled={locked}
                      placeholder="schema"
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          referencesSchema: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Referenced table"
                      value={foreignKey.referencesTable}
                      disabled={locked}
                      placeholder="table"
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          referencesTable: event.currentTarget.value,
                        })
                      }
                    />
                    <input
                      aria-label="Referenced columns"
                      value={foreignKey.referencesColumns}
                      disabled={locked}
                      placeholder="ref cols"
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          referencesColumns: event.currentTarget.value,
                        })
                      }
                    />
                    <select
                      aria-label="On delete"
                      value={foreignKey.onDelete}
                      disabled={locked}
                      onChange={(event) =>
                        updateForeignKey(foreignKey.id, {
                          onDelete: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="">ON DELETE</option>
                      <option value="CASCADE">CASCADE</option>
                      <option value="SET NULL">SET NULL</option>
                      <option value="RESTRICT">RESTRICT</option>
                      <option value="NO ACTION">NO ACTION</option>
                    </select>
                    <button
                      className="mini-button"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        onDraftChange((current) => ({
                          ...current,
                          foreignKeys: current.foreignKeys.filter(
                            (item) => item.id !== foreignKey.id,
                          ),
                        }))
                      }
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <pre className="sql-preview schema-sql">{sqlPreview}</pre>
        </div>
        <div className="dialog-footer">
          <button className="text-button" type="button" onClick={onCopySql}>
            Copy SQL
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={onPutSqlInEditor}
          >
            Put SQL in editor
          </button>
        </div>
      </div>
    </div>
  );
}
