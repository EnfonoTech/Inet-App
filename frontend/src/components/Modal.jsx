export default function Modal({ open, title, onClose, children, wide = false }) {
  if (!open) return null;
  return (
    <div
      className={`modal-overlay${wide ? " modal-overlay-center" : ""}`}
      onClick={onClose}
    >
      <div
        className={`modal${wide ? " modal-wide" : ""}`}
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
