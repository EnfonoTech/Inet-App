export default function Modal({ open, title, onClose, children, wide = false, width }) {
  if (!open) return null;
  const customStyle = width ? { width: typeof width === "number" ? `${width}px` : width, maxWidth: "calc(100vw - 32px)" } : undefined;
  return (
    <div
      className={`modal-overlay${wide || width ? " modal-overlay-center" : ""}`}
      onClick={onClose}
    >
      <div
        className={`modal${wide ? " modal-wide" : ""}`}
        style={customStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
