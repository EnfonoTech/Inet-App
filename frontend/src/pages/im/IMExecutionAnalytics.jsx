import { useNavigate } from "react-router-dom";
import ExecutionAnalytics from "../../components/ExecutionAnalytics";
import { useAuth } from "../../context/AuthContext";

/**
 * The IM's own execution analytics, as a page of its own.
 *
 * Deliberately NOT a tab on Rollout Execution or Rollout Work Done: those two
 * pages have different grains (Rollout Plan vs Daily Execution), and this
 * analysis is per Rollout Plan. Hanging the same figures off both would make
 * at least one of them describe a different population than the table below.
 *
 * Each tile drills into whichever list can actually answer it: planning-state
 * buckets (no execution yet, overdue, no team, unmapped dummy) go to Rollout
 * Execution; execution-state buckets (QC, CIAG, IM confirmation, Work Done)
 * go to Rollout Work Done. Both endpoints accept the same bucket predicate
 * the tile counted with, so the number and the list agree by construction.
 */
export default function IMExecutionAnalytics() {
  const { imName } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Analytics</h1>
          <p className="page-subtitle">
            Your rollout plans analysed — including closed and past-visit work
          </p>
        </div>
      </div>
      <div className="page-content">
        {/* One IM by definition, so an IM breakdown would be a single row. */}
        <ExecutionAnalytics
          imName={imName}
          hideDimensions={["im"]}
          onDrill={(f, target) =>
            navigate(target === "work_done" ? "/im-execution" : "/im-planning", {
              state: { execFilters: f },
            })
          }
        />
      </div>
    </>
  );
}
