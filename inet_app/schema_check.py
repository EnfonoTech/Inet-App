"""Report fields that exist on THIS site but that the app does not ship.

The failure this catches has bitten three times now: a field is added through
the Desk UI (Customize Form, or a hand-made Custom Field) on whichever site the
work was done on, the code is written against it, and every other site 500s on
"Unknown column" because nothing in the app ever creates it.

  * `Sales Invoice Item.milestone` -- invoicing from PIC died on the live site
  * `Rollout Plan.qc_required` / `ciag_required` -- Execution Analytics died,
    and the "QC not required" choice was silently discarded at planning
  * `DUID Master.site_id` -- Material Management reads it by name

A field is "shipped" if it is in the doctype's own JSON, in
fixtures/custom_field.json, or created by setup.py. Anything else exists only
because someone made it here.

Runs as a warning in after_migrate: it must never fail a migrate, because a
site mid-upgrade is exactly when the report is most useful. Run it directly
with

    bench --site <site> execute inet_app.schema_check.run
"""

import json
import os

import frappe

# Columns Frappe manages itself on every table.
_FRAMEWORK_COLUMNS = {
    "name", "creation", "modified", "modified_by", "owner", "docstatus", "idx",
    "_user_tags", "_comments", "_assign", "_liked_by", "_seen",
    "parent", "parentfield", "parenttype",
}

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_DOCTYPE_DIR = os.path.join(_APP_DIR, "inet_app", "doctype")


def _shipped_custom_fields():
    """(dt, fieldname) pairs the app creates outside the doctype JSON."""
    pairs = set()
    fixture = os.path.join(_APP_DIR, "fixtures", "custom_field.json")
    if os.path.exists(fixture):
        try:
            with open(fixture, encoding="utf-8") as fh:
                for row in json.load(fh):
                    if row.get("dt") and row.get("fieldname"):
                        pairs.add((row["dt"], row["fieldname"]))
        except Exception:
            pass
    return pairs


def _setup_source():
    path = os.path.join(_APP_DIR, "setup.py")
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return ""


def find_unshipped_fields():
    """Return [{doctype, field}] for columns on this site the app never creates.

    Only the app's OWN doctypes are examined. Fields other apps add to their
    own doctypes are none of our business, and fields we add to THEIR doctypes
    (Sales Invoice Item.milestone) have to come from the fixture or setup.py,
    which is what the milestone fix established.
    """
    custom = _shipped_custom_fields()
    setup_src = _setup_source()
    out = []

    for folder in sorted(os.listdir(_DOCTYPE_DIR)):
        meta_path = os.path.join(_DOCTYPE_DIR, folder, folder + ".json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
        except Exception:
            continue
        dt = meta.get("name")
        if not dt or not frappe.db.table_exists(dt):
            continue
        shipped = {f["fieldname"] for f in meta.get("fields", []) if f.get("fieldname")}

        try:
            actual = {
                c["Field"]
                for c in frappe.db.sql(f"SHOW COLUMNS FROM `tab{dt}`", as_dict=True)
            }
        except Exception:
            continue

        for field in sorted(actual - shipped - _FRAMEWORK_COLUMNS):
            if (dt, field) in custom:
                continue
            if f'"{field}"' in setup_src or f"'{field}'" in setup_src:
                continue
            out.append({"doctype": dt, "field": field})
    return out


def run():
    """Print the report. Safe to run on any site."""
    rows = find_unshipped_fields()
    if not rows:
        print("schema check: every column on this site is shipped by the app.")
        return rows
    print(f"schema check: {len(rows)} column(s) exist here but are NOT shipped by inet_app.")
    print("Any other site is missing them, and code that reads them will fail there.")
    for r in rows:
        print(f"  - {r['doctype']}.{r['field']}")
    print("Fix by adding the field to the doctype JSON, or to setup.py if it")
    print("belongs to another app's doctype. See inet_app/schema_check.py.")
    return rows


def after_migrate():
    """Hook entry point — reports, never raises."""
    try:
        run()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "inet_app schema check")
