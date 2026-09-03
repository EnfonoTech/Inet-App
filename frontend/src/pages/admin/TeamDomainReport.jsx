import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "../../components/SearchableSelect";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";

/**
 * Team Idle / Project Domain report — the monthly grid handed to the domains.
 *
 * One row per active team (labelled by ISDP account), one column per day.
 * A cell is the project domain the team worked in that day, or "Idle".
 *
 * The domain filter narrows LABELS, not rows: a selected domain shows its own
 * name, any other domain collapses to "Other", no work stays "Idle". So the
 * grid keeps its shape and the idle counts never move when you filter.
 *
 * Sits in the same DataTableWrapper as every other report so the page chrome
 * matches, and hands its rows up via `onExportReady` so the page's single
 * Export button covers it too — this report does not render one of its own. The table keeps its own class rather than `.data-table`: that one
 * is auto-enhanced by DataTablePro with column management and resize handles,
 * which is meaningless for a day-per-column matrix and fights the frozen
 * identity columns. Styling mirrors `.data-table` so the difference does not
 * show — the only colour is the cell status, which is the report's payload.
 */

const IDLE = "Idle";
const OTHER = "Other";
const NA = "-";
const NO_DOMAIN = "No Domain";

/* Cell colours follow the delivered report: red Idle, green Other,
   purple for a domain that matched the filter, grey for not-applicable. */
function cellStyle(v, filterActive) {
  if (v === NA) return { color: "#cbd5e1" };
  if (v === IDLE) return { color: "#C62828", fontWeight: 700 };
  if (v === OTHER) return { background: "#e8f5e9", color: "#2E7D32", fontWeight: 600 };
  if (v === NO_DOMAIN) return { background: "#fff8e1", color: "#8d6e63", fontWeight: 600 };
  // A real domain name: emphasised when the filter singled it out.
  return filterActive
    ? { background: "#ede7f6", color: "#4527A0", fontWeight: 700 }
    : { background: "#e8f0fe", color: "#1565C0", fontWeight: 600 };
}

function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ id, label: d.toLocaleString("en-US", { month: "short", year: "numeric" }) });
  }
  return out;
}

export default function TeamDomainReport({ onExportReady }) {
  const MONTHS = useMemo(monthOptions, []);
  const [month, setMonth] = useState(MONTHS[0].id);
  const [domains, setDomains] = useState([]);
  const [includeFridays, setIncludeFridays] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await pmApi.getTeamDomainUtilization({
          month, domains, include_fridays: includeFridays,
        });
        if (!cancelled) { setData(res); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load the report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month, domains, includeFridays]);

  const filterActive = domains.length > 0;
  const days = data?.days || [];
  const rows = data?.rows || [];
  const cov = data?.coverage || {};

  /* One flat row per team for the Excel hand-off — the domains receive this
     as a file, so the export must mirror the grid exactly. */
  const exportRows = useMemo(() => {
    if (!data) return [];
    const body = rows.map((r) => {
      const o = { "Sr. No": rows.indexOf(r) + 1, "ISDP Account": r.label };
      days.forEach((d, i) => { o[d.label] = r.cells[i]; });
      o["Grand Total (Idle Days)"] = r.idle_days;
      return o;
    });
    const footer = { "Sr. No": "", "ISDP Account": "Total (Idle Teams/Day)" };
    days.forEach((d, i) => { footer[d.label] = data.totals.idle_per_day[i]; });
    footer["Grand Total (Idle Days)"] = data.totals.grand_total_idle;
    return [...body, footer];
  }, [data, rows, days]);

  /* Publish the rows to the page-level Export button. `onExportReady` is the
     parent's stable setState, so this settles after each fetch and does not
     loop. */
  useEffect(() => {
    onExportReady?.({ rows: exportRows, filename: `team-idle-domain-${month}` });
  }, [onExportReady, exportRows, month]);

  return (
    <>
      <div className="toolbar">
        <SearchableSelect
          value={month}
          onChange={setMonth}
          options={MONTHS}
          minWidth={140}
        />
        <SearchableSelect
          multi
          value={domains}
          onChange={setDomains}
          options={(data?.domain_options || []).map((d) => ({ id: d, label: d }))}
          placeholder="All domains"
          allLabel="All domains"
          minWidth={200}
        />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "#475569", fontWeight: 600 }}>
          <input type="checkbox" checked={includeFridays} onChange={(e) => setIncludeFridays(e.target.checked)} />
          Include Fridays
        </label>
      </div>

      <div className="page-content">
        <DataTableWrapper>
          <div className="tdr-wrap">
          {err ? (
            <div className="notice error" style={{ margin: 16 }}><span>⚠</span> {err}</div>
          ) : loading && !data ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading report…</div>
          ) : (
            <>
              {/* An empty-looking grid is usually missing source data, not a
                  bug — say which field is unpopulated rather than let the
                  reader guess. */}
              {(cov.teams_without_isdp > 0 || cov.executions_without_domain > 0) && (
                <div className="tdr-note">
                  {cov.teams_without_isdp > 0 && (
                    <span>{cov.teams_without_isdp} of {cov.teams} teams have no <strong>ISDP Account</strong> set — those rows fall back to the team name. </span>
                  )}
                  {/* Keyed off executions, not projects: a cell resolves its
                      domain from the PO line first (the IM can override it per
                      line) and only falls back to the project, so a project
                      with no domain does not necessarily produce any
                      “No Domain” cell. This counts the work that actually
                      ended up unresolved. */}
                  {cov.executions_without_domain > 0 && (
                    <span>{cov.executions_without_domain} of {cov.executions_in_window} executions this month resolve to no <strong>Project Domain</strong> on either the PO line or its project, so they show as “{NO_DOMAIN}”. </span>
                  )}
                  Leave is not tracked anywhere yet, so no cell can show it.
                </div>
              )}

              <div className="tdr-scroll">
                <table className="tdr-table">
                  <thead>
                    <tr>
                      <th className="tdr-sticky tdr-sr">Sr. No</th>
                      <th className="tdr-sticky tdr-acct">ISDP Account</th>
                      {days.map((d) => (
                        <th key={d.d} title={`${d.label} (${d.dow})`}>
                          {/* Stacked day / mon / year, as in the delivered report. */}
                          {d.label.split("-").map((part, i) => <div key={i}>{part}</div>)}
                        </th>
                      ))}
                      <th className="tdr-total-head">Grand Total (Idle Days)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={r.team}>
                        <td className="tdr-sticky tdr-sr">{ri + 1}</td>
                        <td className="tdr-sticky tdr-acct" title={r.has_isdp ? r.label : `${r.team_name} — no ISDP account set`}>
                          {r.label}
                          {!r.has_isdp && <span className="tdr-warn" title="No ISDP Account on this team">*</span>}
                        </td>
                        {r.cells.map((c, ci) => (
                          <td key={ci} style={cellStyle(c, filterActive)} title={`${days[ci]?.label} · ${c}`}>
                            {c}
                          </td>
                        ))}
                        <td className="tdr-total">{r.idle_days}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={days.length + 3} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                        No active teams.
                      </td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="tdr-sticky tdr-sr" />
                      <td className="tdr-sticky tdr-acct">Total (Idle Teams/Day)</td>
                      {(data?.totals?.idle_per_day || []).map((n, i) => (
                        <td key={i}>{n}</td>
                      ))}
                      <td className="tdr-grand">{data?.totals?.grand_total_idle ?? 0}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
          </div>
        </DataTableWrapper>
      </div>
    </>
  );
}
