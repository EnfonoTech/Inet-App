import PicReportsPanel from "../../components/PicReportsPanel";

/**
 * The PIC's own view of the canned reports. Everything lives in
 * PicReportsPanel so this page and the PM's PIC Overview cannot drift apart.
 */
export default function PICReports() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PIC Reports</h1>
          <div className="page-subtitle">Invoicing pipeline reports</div>
        </div>
      </div>
      <PicReportsPanel />
    </div>
  );
}
