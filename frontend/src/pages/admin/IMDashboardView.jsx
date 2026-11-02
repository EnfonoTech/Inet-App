import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import IMDashboard from "../im/IMDashboard";
import { pmApi } from "../../services/api";

export default function IMDashboardView() {
  const [imList, setImList] = useState([]);
  const [selectedIm, setSelectedIm] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const ims = await pmApi.listIMMasters({});
        const list = Array.isArray(ims) ? ims : [];
        setImList(list);
        if (list.length > 0) setSelectedIm(list[0].name);
      } catch { setImList([]); }
    })();
  }, []);

  // The IM picker sits in the dashboard header's empty left side.
  const picker = (
    <>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#334155", whiteSpace: "nowrap" }}>IM</span>
      <select value={selectedIm} onChange={(e) => setSelectedIm(e.target.value)}
        style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, minWidth: 200, background: "#fff" }}>
        {imList.map((im) => <option key={im.name} value={im.name}>{im.full_name || im.name}</option>)}
      </select>
    </>
  );

  return (
    <div className="nd-dashboard" style={{ padding: "10px 16px" }}>
      <DashboardSwitcher />
      {selectedIm ? (
        <IMDashboard key={selectedIm} overrideIm={selectedIm} headerLeft={picker} />
      ) : (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Select an IM to view their dashboard.</div>
      )}
    </div>
  );
}
