import { AlertTriangle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  aiEngineStatus,
  aiExplainPlan,
  aiGetProvider,
  type QueryPlanAnalysis,
} from "@/generated/irodori-api";

export function PlanAiExplanation({ plan }: { plan: QueryPlanAnalysis }) {
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNarration(null);
    setNarrationError(null);
    setNarrating(false);
    setProviderReady(null);

    void (async () => {
      try {
        const provider = await aiGetProvider();
        let usable = Boolean(provider?.kind);
        if (provider?.kind === "local") {
          const status = await aiEngineStatus().catch(() => null);
          usable = Boolean(status && status.compiled && status.modelPresent);
        }
        if (!cancelled) setProviderReady(usable);
      } catch {
        if (!cancelled) setProviderReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan]);

  const explain = async () => {
    if (narrating) return;
    setNarrating(true);
    setNarrationError(null);
    try {
      const text = await aiExplainPlan(plan);
      setNarration(text);
    } catch (err) {
      setNarrationError(err instanceof Error ? err.message : String(err));
    } finally {
      setNarrating(false);
    }
  };

  return (
    <section className="plan-section compact plan-ai-explanation">
      <div className="plan-section-title">
        <Sparkles size={14} />
        <span>AI explanation</span>
      </div>

      {providerReady === false ? (
        <div className="plan-empty-card">
          Configure an AI provider in Settings to enable AI explanations.
        </div>
      ) : (
        <>
          <button
            type="button"
            className="plan-ai-explain-button"
            onClick={explain}
            disabled={providerReady !== true || narrating}
            aria-label="Explain this query plan with AI"
          >
            <Sparkles size={13} />
            <span>{narrating ? "Explaining…" : "Explain with AI"}</span>
          </button>

          {narrationError ? (
            <div className="plan-error" role="alert">
              <AlertTriangle size={15} />
              <span>{narrationError}</span>
            </div>
          ) : null}

          {narration ? (
            <p className="plan-ai-narration" style={{ whiteSpace: "pre-wrap" }}>
              {narration}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
