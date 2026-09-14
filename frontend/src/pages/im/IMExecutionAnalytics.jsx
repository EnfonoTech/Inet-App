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
 * Read-only for the same reason — there is no IM list at this grain to drill
 * into whose count would match. A dead tile beats a lying one.
 */
export default function IMExecutionAnalytics() {
  const { imName } = useAuth();
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
        <ExecutionAnalytics imName={imName} monitorHref={null} hideDimensions={["im"]} />
      </div>
    </>
  );
}
