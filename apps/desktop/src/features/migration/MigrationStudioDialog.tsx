import { useEffect, useMemo, useState } from "react";
import { DialogShell } from "@/components/DialogShell";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type Translator } from "@/i18n";
import { Copy, FileText } from "lucide-react";
import {
  buildMigrationPlan,
  createMigrationPlanPlaceholder,
  defaultMigrationDraft,
  migrationEngineOptions,
  migrationOutputTabs,
  migrationOutputText,
  type MigrationDraft,
  type MigrationEngine,
  type MigrationExportFormat,
  type MigrationOutputKind,
  type MigrationPlan,
} from "./migration-studio";
import { errorMessage } from "@/core";

type MigrationStudioDialogProps = {
  onClose: () => void;
  onCopyText: (text: string, label: string) => void;
  onPutTextInEditor: (text: string) => void;
};

const migrationOutputTabKeys: Record<
  MigrationOutputKind,
  Parameters<Translator["t"]>[0]
> = {
  diff: "migration.output.diff",
  overview: "migration.output.overview",
  runbook: "migration.output.runbook",
  source: "migration.output.source",
  target: "migration.output.target",
};

export function MigrationStudioDialog({
  onClose,
  onCopyText,
  onPutTextInEditor,
}: MigrationStudioDialogProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const [draft, setDraft] = useState<MigrationDraft>(defaultMigrationDraft);
  const [activeOutput, setActiveOutput] =
    useState<MigrationOutputKind>("overview");
  const [planState, setPlanState] = useState<{
    status: "loading" | "ready" | "error";
    plan: MigrationPlan;
  }>(() => ({
    status: "loading",
    plan: createMigrationPlanPlaceholder(defaultMigrationDraft, undefined, t),
  }));

  useEffect(() => {
    let cancelled = false;
    setPlanState({
      status: "loading",
      plan: createMigrationPlanPlaceholder(draft, undefined, t),
    });

    buildMigrationPlan(draft)
      .then((plan) => {
        if (!cancelled) {
          setPlanState({ status: "ready", plan });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = errorMessage(error);
          setPlanState({
            status: "error",
            plan: createMigrationPlanPlaceholder(draft, message, t),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draft, t]);

  const plan = planState.plan;
  const outputText = migrationOutputText(plan, activeOutput, t);
  const outputLabel = t(migrationOutputTabKeys[activeOutput]);
  const editorButtonLabel =
    activeOutput === "overview" || activeOutput === "runbook"
      ? t("migration.actions.putText")
      : t("migration.actions.putSql");

  function updateDraft<K extends keyof MigrationDraft>(
    key: K,
    value: MigrationDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <DialogShell
      className="data-dialog migration-dialog"
      label={t("migration.title")}
      onClose={onClose}
    >
      <div className="dialog-header">
        <strong>{t("migration.title")}</strong>
        <span>
          {planState.status === "loading"
            ? t("migration.status.building")
            : plan.title}
        </span>
        <button className="text-button" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div className="dialog-body migration-body">
        <section className="migration-form" aria-label={t("migration.inputs")}>
          <div className="migration-form-grid">
            <label>
              <span>{t("migration.source")}</span>
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
              <span>{t("migration.sourceVersion")}</span>
              <input
                value={draft.sourceVersion}
                onChange={(event) =>
                  updateDraft("sourceVersion", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.target")}</span>
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
              <span>{t("migration.targetVersion")}</span>
              <input
                value={draft.targetVersion}
                onChange={(event) =>
                  updateDraft("targetVersion", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.sourceTable")}</span>
              <input
                value={draft.sourceTable}
                onChange={(event) =>
                  updateDraft("sourceTable", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.targetTable")}</span>
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
              <span>{t("migration.keyColumns")}</span>
              <textarea
                rows={5}
                value={draft.keyColumnsText}
                onChange={(event) =>
                  updateDraft("keyColumnsText", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.compareColumns")}</span>
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
              <span>{t("migration.partitionColumn")}</span>
              <input
                value={draft.partitionColumn}
                onChange={(event) =>
                  updateDraft("partitionColumn", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.predicate")}</span>
              <input
                value={draft.partitionPredicate}
                onChange={(event) =>
                  updateDraft("partitionPredicate", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>{t("migration.export")}</span>
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
                <option value="tsv">TSV</option>
              </select>
            </label>
            <label>
              <span>{t("migration.batchRows")}</span>
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
              <span>{t("migration.diffLimit")}</span>
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
              <span>{t("migration.delimiter")}</span>
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
              <span>{t("migration.normalizeWhitespace")}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.normalizeCase}
                onChange={(event) =>
                  updateDraft("normalizeCase", event.currentTarget.checked)
                }
              />
              <span>{t("migration.normalizeCase")}</span>
            </label>
          </div>
        </section>

        <section
          className="migration-preview"
          aria-label={t("migration.output.label")}
        >
          <div
            className="segmented-control migration-tabs"
            aria-label={t("migration.output.label")}
          >
            {migrationOutputTabs.map((tab) => (
              <button
                className={activeOutput === tab.value ? "active" : undefined}
                type="button"
                key={tab.value}
                onClick={() => setActiveOutput(tab.value)}
              >
                {t(migrationOutputTabKeys[tab.value])}
              </button>
            ))}
          </div>

          {activeOutput === "overview" ? (
            <MigrationOverview plan={plan} t={t} />
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
          <span>{t("common.copy")}</span>
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
  t,
}: {
  plan: MigrationPlan;
  t: Translator["t"];
}) {
  return (
    <div className="migration-overview">
      <div className="migration-summary-grid">
        <div>
          <small>{t("migration.overview.route")}</small>
          <strong>
            {plan.sourceLabel}
            {" -> "}
            {plan.targetLabel}
          </strong>
        </div>
        <div>
          <small>{t("migration.overview.keys")}</small>
          <strong>{plan.keys.length}</strong>
        </div>
        <div>
          <small>{t("migration.overview.hashColumns")}</small>
          <strong>{plan.hashColumns.length}</strong>
        </div>
        <div>
          <small>{t("migration.overview.hash")}</small>
          <strong>{plan.hashAlgorithmLabel}</strong>
        </div>
        <div>
          <small>{t("migration.overview.warnings")}</small>
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
        <strong>{t("migration.plan.engineNotes")}</strong>
        <ul>
          {plan.pairNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      {plan.warnings.length > 0 ? (
        <div className="migration-notes warning">
          <strong>{t("migration.plan.warnings")}</strong>
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
