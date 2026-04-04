import { useState } from "react";
import Modal from "./Modal";
import { pmApi } from "../services/api";

export default function NewCustomerModal({ open, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCustomerName("");
    setCustomerType("");
    setError("");
    setSaving(false);
  };

  const submit = async () => {
    setError("");
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    setSaving(true);
    try {
      const result = await pmApi.createCustomer({
        customer_name: customerName.trim(),
        customer_type: customerType.trim(),
      });
      onCreated?.(result);
      reset();
      onClose?.();
    } catch (e) {
      setError(e?.message || "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} title="Create Customer" onClose={() => { reset(); onClose?.(); }} maxWidth={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error ? <div className="form-error">{error}</div> : null}

        <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(180px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Customer Name</span>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. STC" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Customer Type</span>
            <input value={customerType} onChange={(e) => setCustomerType(e.target.value)} placeholder="Optional" />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button className="btn-secondary" onClick={() => { reset(); onClose?.(); }} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

