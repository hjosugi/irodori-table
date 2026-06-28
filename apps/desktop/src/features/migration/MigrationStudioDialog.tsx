import { useMemo, useState } from "react";
import { DialogShell } from "@/components/DialogShell";
import { Copy, FileText } from "lucide-react";
import {
  buildMigrationPlan,
  defaultMigrationDraft,
  migrationEngineOptions,
  migrationOutputTabs,
  migrationOutputText,
  type MigrationDraft,
  type MigrationEngine,
  type MigrationExportFormat,
  type MigrationOutputKind,
} from "./migration-studio";

type MigrationStudioDialogProps = {
  onClose: () => void;
  onCopyText: (text: string, label: string) => void;
  onPutTextInEditor: (text: string) => void;
};

export function MigrationStudioDialog({
  onClose,
  onCopyText,
  onPutTextInEditor,
}: MigrationStudioDialogProps) {
  const [draft, setDraft] = useState<MigrationDraft>(defaultMigrationDraft);
  const [activeOutput, setActiveOutput] =
    useState<MigrationOutputKind>("overview");
  const plan = useMemo(() => buildMigrationPlan(draft), [draft]);
  const outputText = migrationOutputText(plan, activeOutput);
  const outputLabel =
    migrationOutputTabs.find((tab) => tab.value === activeOutput)?.label ??
    "Output";
  const editorButtonLabel =
    activeOutput === "overview" || activeOutput === "runbook"
      ? "Put text in editor"
      : "Put SQL in editor";

  function updateDraft<K extends keyof MigrationDraft>(
    key: K,
    value: MigrationDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <DialogShell
      className="data-dialog migration-dialog"
      label="Migration Studio"
      onClose={onClose}
    >
      <div className="dialog-header">
        <strong>Migration Studio</strong>
        <span>{plan.title}</span>
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body migration-body">
        <section className="migration-form" aria-label="Migration inputs">
          <div className="migration-form-grid">
            <label>
              <span>Source</span>
              <select
                value={draft.sourceEngine}
                onChange={(event) =>
                  updateDraft(
                    "sourceEngine",
                    event.currentTarget.value as MigrationEngine,
                  )
                }
              >
                {migrationEngineOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source version</span>
              <input
                value={draft.sourceVersion}
                onChange={(event) =>
                  updateDraft("sourceVersion", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Target</span>
              <select
                value={draft.targetEngine}
                onChange={(event) =>
                  updateDraft(
                    "targetEngine",
                    event.currentTarget.value as MigrationEngine,
                  )
                }
              >
                {migrationEngineOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target version</span>
              <input
                value={draft.targetVersion}
                onChange={(event) =>
                  updateDraft("targetVersion", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Source table</span>
              <input
                value={draft.sourceTable}
                onChange={(event) =>
                  updateDraft("sourceTable", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Target table</span>
              <input
                value={draft.targetTable}
                onChange={(event) =>
                  updateDraft("targetTable", event.currentTarget.value)
                }
              />
            </label>
          </div>

          <div className="migration-textareas">
            <label>
              <span>Key columns</span>
              <textarea
                rows={5}
                value={draft.keyColumnsText}
                onChange={(event) =>
                  updateDraft("keyColumnsText", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Compare columns</span>
              <textarea
                rows={5}
                value={draft.compareColumnsText}
                onChange={(event) =>
                  updateDraft("compareColumnsText", event.currentTarget.value)
                }
              />
            </label>
          </div>

          <div className="migration-form-grid compact">
            <label>
              <span>Partition column</span>
              <input
                value={draft.partitionColumn}
                onChange={(event) =>
                  updateDraft("partitionColumn", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Predicate</span>
              <input
                value={draft.partitionPredicate}
                onChange={(event) =>
                  updateDraft("partitionPredicate", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>Export</span>
              <select
                value={draft.exportFormat}
                onChange={(event) =>
                  updateDraft(
                    "exportFormat",
                    event.currentTarget.value as MigrationExportFormat,
                  )
                }
              >
                <option value="parquet">Parquet</option>
                <option value="csv">CSV</option>
              </select>
            </label>
            <label>
              <span>Batch rows</span>
              <input
                min={1000}
                step={1000}
                type="number"
                value={draft.batchSize}
                onChange={(event) =>
                  updateDraft("batchSize", Number(event.currentTarget.value))
                }
              />
            </label>
            <label>
              <span>Diff limit</span>
              <input
                min={10}
                step={100}
                type="number"
                value={draft.diffLimit}
                onChange={(event) =>
                  updateDraft("diffLimit", Number(event.currentTarget.value))
                }
              />
            </label>
            <label>
              <span>Delimiter</span>
              <input
                value={draft.delimiter}
                onChange={(event) =>
                  updateDraft("delimiter", event.currentTarget.value)
                }
              />
            </label>
          </div>

          <div className="migration-options">
            <label>
              <input
                type="checkbox"
                checked={draft.normalizeWhitespace}
                onChange={(event) =>
                  updateDraft(
                    "normalizeWhitespace",
                    event.currentTarget.checked,
                  )
                }
              />
              <span>Normalize whitespace</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.normalizeCase}
                onChange={(event) =>
                  updateDraft("normalizeCase", event.currentTarget.checked)
                }
              />
              <span>Lowercase text before hash</span>
            </label>
          </div>
        </section>

        <section className="migration-preview" aria-label="Migration output">
          <div
            className="segmented-control migration-tabs"
            aria-label="Migration output"
          >
            {migrationOutputTabs.map((tab) => (
              <button
                className={activeOutput === tab.value ? "active" : undefined}
                type="button"
                key={tab.value}
                onClick={() => setActiveOutput(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeOutput === "overview" ? (
            <MigrationOverview plan={plan} />
          ) : (
            <pre className="sql-preview migration-output">{outputText}</pre>
          )}
        </section>
      </div>
      <div className="dialog-footer">
        <button
          className="text-button"
          type="button"
          onClick={() => onCopyText(outputText, outputLabel)}
        >
          <Copy size={14} />
          <span>Copy</span>
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={() => onPutTextInEditor(outputText)}
        >
          <FileText size={14} />
          <span>{editorButtonLabel}</span>
        </button>
      </div>
    </DialogShell>
  );
}

function MigrationOverview({
  plan,
}: {
  plan: ReturnType<typeof buildMigrationPlan>;
}) {
  return (
    <div className="migration-overview">
      <div className="migration-summary-grid">
        <div>
          <small>Route</small>
          <strong>
            {plan.sourceLabel}
            {" -> "}
            {plan.targetLabel}
          </strong>
        </div>
        <div>
          <small>Keys</small>
          <strong>{plan.keys.length}</strong>
        </div>
        <div>
          <small>Hash columns</small>
          <strong>{plan.hashColumns.length}</strong>
        </div>
        <div>
          <small>Warnings</small>
          <strong>{plan.warnings.length}</strong>
        </div>
      </div>

      <div className="migration-task-list">
        {plan.tasks.map((task) => (
          <div className={`migration-task ${task.level}`} key={task.title}>
            <strong>{task.title}</strong>
            <span>{task.detail}</span>
          </div>
        ))}
      </div>

      <div className="migration-notes">
        <strong>Engine notes</strong>
        <ul>
          {plan.pairNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      {plan.warnings.length > 0 ? (
        <div className="migration-notes warning">
          <strong>Warnings</strong>
          <ul>
            {plan.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
