import { useState } from "react";
import { pmApi } from "../services/api";

/**
 * The IM's rating of the team that did one job.
 *
 * Five criteria, 1..5 stars each, 0 meaning not rated. They live on the
 * Daily Execution — one row per team per job per date, which is the grain
 * the rating is asked for — so the scores stay with the record and the
 * history needs no second doctype.
 *
 * Keep RATING_CRITERIA in step with TEAM_RATING_FIELDS in command_center.py;
 * the endpoint rejects any field it does not know.
 */
export const RATING_CRITERIA = [
  { field: "rating_execution", label: "Execution Performance" },
  { field: "rating_quality", label: "Quality" },
  { field: "rating_safety", label: "Safety Compliance" },
  { field: "rating_timeliness", label: "Timeliness" },
  { field: "rating_overall", label: "Overall Performance" },
];

export function ratingOf(row, field) {
  return Math.max(0, Math.min(5, Number(row?.[field] || 0)));
}

/** True once any of the five carries a score. */
export function isRated(row) {
  return RATING_CRITERIA.some((c) => ratingOf(row, c.field) > 0);
}

/** Mean of the criteria actually scored — unrated ones do not drag it down. */
export function ratingAverage(row) {
  const given = RATING_CRITERIA.map((c) => ratingOf(row, c.field)).filter((n) => n > 0);
  if (!given.length) return 0;
  return given.reduce((a, b) => a + b, 0) / given.length;
}

const STAR_ON = "#f59e0b";
const STAR_OFF = "#cbd5e1";

/**
 * Five stars. Read-only without `onChange`. Tapping the star that is already
 * lit clears the score back to unrated, which is the only way to undo a
 * mis-tap without a separate button.
 */
export function StarRating({ value = 0, onChange, size = 18, title }) {
  const score = Math.max(0, Math.min(5, Number(value || 0)));
  const readOnly = typeof onChange !== "function";
  return (
    <span
      style={{ display: "inline-flex", gap: 2, lineHeight: 1, alignItems: "center" }}
      title={title || (score ? `${score} of 5` : "Not rated")}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          role={readOnly ? undefined : "button"}
          tabIndex={readOnly ? undefined : 0}
          onClick={readOnly ? undefined : (e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(n === score ? 0 : n);
          }}
          onKeyDown={readOnly ? undefined : (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onChange(n === score ? 0 : n);
          }}
          style={{
            fontSize: size,
            color: n <= score ? STAR_ON : STAR_OFF,
            cursor: readOnly ? "default" : "pointer",
            userSelect: "none",
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * The table cell: the overall score at a glance, every criterion in the
 * tooltip, and "— Rate —" while nothing has been given yet.
 */
export function TeamRatingCell({ row, onClick }) {
  const rated = isRated(row);
  const tip = rated
    ? RATING_CRITERIA
        .map((c) => `${c.label}: ${ratingOf(row, c.field) || "—"}`)
        .join("\n")
    : "Not rated yet";
  if (!rated) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Rate this team"
        style={{
          border: "none", background: "none", padding: 0, cursor: "pointer",
          fontSize: "0.78rem", color: "#94a3b8", fontWeight: 500,
        }}
      >
        — Rate —
      </button>
    );
  }
  // Without an onClick this is a read-only cell (the PM's Work Done page),
  // so it must not look or behave like a button.
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={tip}
      style={{
        border: "none", background: "none", padding: 0,
        cursor: onClick ? "pointer" : "default",
        display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      }}
    >
      <StarRating value={ratingOf(row, "rating_overall")} size={14} title={tip} />
      <span style={{ fontSize: "0.72rem", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
        {ratingAverage(row).toFixed(1)}
      </span>
    </Tag>
  );
}

/** Read-only block for a detail panel. */
export function TeamRatingView({ row }) {
  if (!isRated(row)) {
    return <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Not rated.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {RATING_CRITERIA.map((c) => (
        <div key={c.field} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.78rem", color: "#475569", minWidth: 150 }}>{c.label}</span>
          <StarRating value={ratingOf(row, c.field)} size={14} />
        </div>
      ))}
      {row.rating_remark ? (
        <div style={{ fontSize: "0.78rem", color: "#334155", marginTop: 2, whiteSpace: "pre-wrap" }}>
          {row.rating_remark}
        </div>
      ) : null}
      {row.rated_by ? (
        <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
          Rated by {row.rated_by_name || row.rated_by}
          {row.rated_on ? ` · ${String(row.rated_on).slice(0, 16).replace("T", " ")}` : ""}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The editor. `row` is any object carrying the execution name plus whatever
 * scores it already has; `onSaved` receives the saved values so the caller
 * can patch its row in place instead of refetching the whole grid.
 */
export function TeamRatingModal({ row, onClose, onSaved }) {
  const [scores, setScores] = useState(() => {
    const init = {};
    for (const c of RATING_CRITERIA) init[c.field] = ratingOf(row, c.field);
    return init;
  });
  const [remark, setRemark] = useState(row?.rating_remark || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // `execution` first: on a Work Done row `name` is the Work Done, and
  // rating that would write to the wrong document. On an execution row
  // there is no `execution` key and `name` is the execution itself.
  const execName = row?.execution || row?.name || "";

  function setOne(field, value) {
    setScores((prev) => {
      const next = { ...prev, [field]: value };
      // Overall is the IM's own judgement, not an average — but starting it
      // at the mean of the four saves a tap on the common case where it
      // agrees with them. Only while the IM has not set it themselves.
      if (field !== "rating_overall" && !prev.rating_overall) {
        const given = RATING_CRITERIA
          .filter((c) => c.field !== "rating_overall")
          .map((c) => next[c.field])
          .filter((n) => n > 0);
        if (given.length) {
          next.rating_overall = Math.round(given.reduce((a, b) => a + b, 0) / given.length);
        }
      }
      return next;
    });
  }

  async function save() {
    if (!execName) { setErr("No execution to rate."); return; }
    setBusy(true); setErr(null);
    try {
      const saved = await pmApi.rateExecution(execName, scores, remark);
      onSaved?.(saved);
      onClose?.();
    } catch (e) {
      setErr(e.message || "Could not save the rating");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(520px, 94vw)", maxHeight: "88dvh", overflowY: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h4 style={{ margin: "0 0 2px" }}>Team Rating</h4>
        <div style={{ fontSize: "0.76rem", color: "#64748b", marginBottom: 14 }}>
          {row?.team_name || row?.team || "—"}
          {row?.poid ? ` · ${row.poid}` : ""}
          {row?.execution_date ? ` · ${row.execution_date}` : ""}
        </div>
        {err && <div className="notice error" style={{ marginBottom: 10 }}>{err}</div>}

        {RATING_CRITERIA.map((c) => (
          <div
            key={c.field}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}
          >
            <span style={{ fontSize: "0.84rem", color: "#334155", fontWeight: c.field === "rating_overall" ? 700 : 500 }}>
              {c.label}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <StarRating value={scores[c.field]} onChange={(v) => setOne(c.field, v)} size={22} />
              <span style={{ fontSize: "0.72rem", color: "#94a3b8", width: 14, textAlign: "right" }}>
                {scores[c.field] || "—"}
              </span>
            </span>
          </div>
        ))}

        <div className="form-group" style={{ margin: "14px 0 12px" }}>
          <label style={{ fontSize: "0.8rem" }}>Remark</label>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            placeholder="Optional — what the score is about"
            style={{ width: "100%", padding: 8, resize: "vertical" }}
          />
        </div>

        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "…" : "Save Rating"}
        </button>
        <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default TeamRatingModal;
