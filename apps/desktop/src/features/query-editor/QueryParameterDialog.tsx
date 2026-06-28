import type { FormEvent } from "react";
import { KeyRound, Play } from "lucide-react";
import { DialogShell } from "@/components/DialogShell";
import type { QueryParameterPromptSet } from "@/generated/irodori-api";

export type PendingQueryParameters = {
  sql: string;
  promptSet: QueryParameterPromptSet;
};

function compactSql(sql: string, maxLength = 68) {
  const compact = sql.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

export function QueryParameterDialog({
  pending,
  values,
  onValuesChange,
  onClose,
  onSubmit,
}: {
  pending: PendingQueryParameters;
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogShell
      className="parameter-dialog"
      label="Query parameters"
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="parameter-header">
          <KeyRound size={16} />
          <strong>Query Parameters</strong>
          <span>{compactSql(pending.sql)}</span>
        </div>
        <div className="parameter-list">
          {pending.promptSet.prompts.map((prompt, index) => (
            <label className="parameter-row" key={prompt.id}>
              <span>
                <strong>{prompt.label}</strong>
                <small>{prompt.placeholder}</small>
              </span>
              <input
                autoFocus={index === 0}
                value={values[prompt.id] ?? ""}
                onChange={(event) =>
                  onValuesChange({
                    ...values,
                    [prompt.id]: event.target.value,
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="parameter-actions">
          <button className="text-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <Play size={14} />
            Run
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
