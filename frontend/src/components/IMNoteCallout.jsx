// Small callout for the IM's "Note for field team"
// (PO Dispatch.manager_remark). Renders nothing when the note is empty,
// so callers can drop it into any detail view without conditional logic.
//
// `compact` — render as a single inline row with a small icon prefix.
// Use this on dense surfaces (Today's Work cards) where the full amber
// card-within-card feels heavy.
export default function IMNoteCallout({ note, label = "IM NOTE", style, compact = false }) {
  const text = (note || "").trim();
  if (!text) return null;

  if (compact) {
    return (
      <div
        title={text}
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          fontSize: "0.78rem",
          color: "#92400e",
          lineHeight: 1.35,
          ...style,
        }}
      >
        <span aria-hidden="true" style={{ flexShrink: 0, opacity: 0.85 }}>📝</span>
        <span style={{
          flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
        }}>
          {text}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        margin: "12px 0",
        padding: "10px 12px",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 8,
        fontSize: "0.84rem",
        color: "#92400e",
        whiteSpace: "pre-wrap",
        lineHeight: 1.4,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "0.66rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          marginBottom: 4,
          opacity: 0.85,
        }}
      >
        {label}
      </div>
      {text}
    </div>
  );
}
