/**
 * Required documents per activity type — the one definition.
 *
 * This map was copied into three pages (im/IMWorkDone, admin/WorkDone,
 * pic/PICTracker) and had already drifted: PICTracker's copy carried no
 * `accept` keys at all, so the same slot restricted file types on two pages
 * and not on the third. It lives here so the next policy change is one edit.
 *
 * Shape:
 *   doc1Label                      label for the first (mail) slot
 *   doc2: null                     no second document for this activity
 *   doc2: { label, accept }        second document, with accepted extensions
 *   doc2: { label, parts, accept } second document split into named slots
 *
 * `accept` only feeds the browser file picker — it is a hint, not a rule.
 * Nothing on the server checks the extension (see the doc-slot upload in
 * command_center.py, which validates the SLOT but never the file), so a user
 * who picks "All files" can upload anything regardless. Treat these as
 * guidance to the user, not as enforcement.
 */
export const DOC_REQUIREMENTS = {
  "installation":    { doc1Label: "Confirmation Mail", doc2: null },
  "Dismantle":       { doc1Label: "Confirmation Mail", doc2: { label: "Supporting Documents", parts: [{ label: "Dismantling Checklist", slot: "im_doc2a" }, { label: "PPT", slot: "im_doc2b" }, { label: "POD", slot: "im_doc2c" }], accept: ".pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx" } },
  "Survey & Design": { doc1Label: "Confirmation Mail", doc2: { label: "Survey Report", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" } },
  "PAT":             { doc1Label: "Confirmation Mail", doc2: { label: "PAT Document", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" } },
  "Design":          { doc1Label: "Confirmation Mail", doc2: { label: "MOP / SED", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" } },
  "test":            { doc1Label: "Confirmation Mail", doc2: { label: "Test Report", accept: ".pdf,.xls,.xlsx,.doc,.docx,.csv" } },
  // The format IS the deliverable for these two, so they stay narrow:
  // a POD is a signed delivery note, and a justification is the mail itself.
  "Visit":           { doc1Label: "Confirmation Mail", doc2: { label: "Visit Justification Mail", accept: ".msg" } },
  "Local Material":  { doc1Label: "Confirmation Mail", doc2: { label: "POD", accept: ".pdf" } },
  "commission":      { doc1Label: "Confirmation", doc2: null },
  "Acquizision":     { doc1Label: "Confirmation", doc2: null },
  "Batteries":       { doc1Label: "Confirmation Mail", doc2: null },
  "Migration":       { doc1Label: "Confirmation Mail", doc2: null },
  "Document":        { doc1Label: "Confirmation Mail", doc2: { label: "Document", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" } },
};

export default DOC_REQUIREMENTS;
