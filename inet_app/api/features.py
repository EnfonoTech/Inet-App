"""Feature switches, read from INET Settings.

Some of what this app can do is not something the business wants on all the
time. Partial-quantity closing and the subcontractor split were built for cases
the client raised, but neither is wanted day to day — and while data is being
cleaned up, a switch that takes a whole route out of play is worth more than a
careful explanation of when not to use it.

Every switch DEFAULTS ON, so a site that has never opened the settings page
behaves exactly as it did before this existed. Turning one off disables the
route in the API, not merely in the UI: the portal hides what is off, but the
endpoint is what actually refuses, so a stale tab or a direct call cannot slip
past.
"""

import frappe
from frappe.utils import cint

# fieldname -> (what the route is called, what the user can do instead).
#
# The message is split by audience. Telling an IM to go and change INET
# Settings is no help — they cannot open it, and it reads as the system
# blaming them for a decision somebody else made. They are told the route is
# unavailable and who to ask; an admin is told where the switch is.
FEATURES = {
    "enable_direct_close": ("Direct Close", None),
    "enable_backend_assign": ("Backend Assign", None),
    "enable_partial_close": (
        "Partial quantity closing", "A line can only be closed in full."),
    "enable_subcontractor_split": (
        "Splitting a line across subcontractors", None),
}


def feature_enabled(fieldname):
    """True unless an administrator has explicitly switched this off.

    Defaults ON for the missing-field and missing-row cases alike: a site that
    has not migrated yet, or has never saved the settings, must keep working.
    """
    if fieldname not in FEATURES:
        frappe.throw(f"Unknown feature switch: {fieldname}")
    # Read the raw `tabSingles` row rather than get_single_value, which casts a
    # Check to cint() and so returns 0 both for "switched off" and for "never
    # configured" — making every new switch read as off on a site that has not
    # opened the settings page. The absence of a row is the only honest signal
    # that nobody has made a decision yet, and that means ON.
    #
    # INET Settings is a Single, so it has no `tabINET Settings` table at all:
    # has_column() on it is always False, which is its own trap.
    try:
        row = frappe.db.sql(
            """SELECT value FROM `tabSingles`
               WHERE doctype = 'INET Settings' AND field = %s""",
            (fieldname,),
        )
    except Exception:
        return True
    if not row:
        return True
    value = row[0][0]
    return True if value in (None, "") else bool(cint(value))


def _off_message(fieldname):
    label, extra = FEATURES[fieldname]
    tail = f" {extra}" if extra else ""
    try:
        from inet_app.roles import is_admin
        admin = is_admin()
    except Exception:
        admin = False
    if admin:
        return f"{label} is switched off in INET Settings.{tail}"
    return (f"{label} is not available.{tail} "
            f"Ask an administrator if you need it switched on.")


def require_feature(fieldname):
    """Throw when the switch is off, in words the reader can act on."""
    if not feature_enabled(fieldname):
        frappe.throw(_off_message(fieldname), title="Not available")


@frappe.whitelist()
def get_feature_flags():
    """Every switch, for the portal to hide what is off.

    The UI reads this to keep switched-off routes out of the way; it is not
    what enforces them. Each endpoint calls require_feature itself.
    """
    return {k: feature_enabled(k) for k in FEATURES}
