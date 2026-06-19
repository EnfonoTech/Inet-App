/**
 * Daily Execution status options.
 *
 * `execution_status` is the IM-confirmed status; `tl_status` is the field Team
 * Lead's status (which the IM can also edit). Both share the same short list
 * so teams + IMs use the same vocabulary.
 */
export const EXECUTION_STATUS_OPTIONS = [
  "In Progress",
  "Completed",
  "Hold",
  "Cancelled",
  "Postponed",
];

/** TL-only statuses — superset of EXECUTION_STATUS_OPTIONS. */
export const TL_STATUS_OPTIONS = [
  ...EXECUTION_STATUS_OPTIONS,
  "Not Attended",
];

/** Issue Category select values — used on Rollout Plan + Daily Execution. */
export const ISSUE_CATEGORY_OPTIONS = [
  "Late Arrival",
  "Extra Visit",
  "PAT Rejection",
  "QC Rejection",
  "POD Pending",
  "Spare Parts Pending",
  "Site Access Issue",
  "Material Shortage",
  "Customer Hold",
  "Other",
];
