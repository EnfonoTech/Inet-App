import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import PicReportsPanel from "../../components/PicReportsPanel";

/**
 * The PIC's own view of the canned reports. Everything lives in
 * PicReportsPanel so this page and the PM's PIC Overview cannot drift apart.
 */
export default function PICReports() {
  const { role } = useAuth();
  const navigate = useNavigate();
  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {role !== "pic" && (
              <button type="button" className="btn-secondary" onClick={() => navigate(-1)}
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}>← Back</button>
            )}
            <h1 className="page-title">PIC Reports</h1>
          </div>
          <div className="page-subtitle">Invoicing pipeline reports</div>
        </div>
      </div>
      <PicReportsPanel />
    </div>
  );
}
