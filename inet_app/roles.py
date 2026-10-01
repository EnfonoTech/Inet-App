"""Who counts as what, in one place.

``INET PM`` used to carry no permissions at all. It marked an admin whose
sidebar hid Switch to Desk, Masters and the Certificate Tracker, and a
``User.validate`` hook quietly added ``INET Admin`` alongside it — so every
``"INET Admin" in roles`` test in the app passed for a PM, and PM and admin
were the same thing server-side. That was workable until something had to be
admin-only: approving a Direct Close. You cannot withhold from a PM a power
they hold through a role they are always given.

So the two are separated. ``INET PM`` is now a real role whose DocType
permissions are mirrored from ``INET Admin`` on every migrate (see
``setup._mirror_admin_permissions_to_pm``) — derived, never hand-maintained,
which is what made a second role unattractive before.

Two sets, and the distinction between them is the whole point:

``PM_LEVEL_ROLES``
    May run the operation. Everything a PM could do before this split, they
    still do, because every check that used to name ``INET Admin`` now names
    this set and a PM is in it.

``ADMIN_ROLES``
    May approve what a PM requests. ``INET PM`` is absent: holding it alone is
    not admin. Holding it *alongside* ``INET Admin`` still is — the marker
    reduces the sidebar, it does not revoke a role someone was given.

``Administrator`` and ``System Manager`` are in both: Frappe returns
``Administrator`` from ``get_roles`` for that user, and someone with desk
access already holds every key the portal could withhold.
"""

import frappe

#: Roles that may act at PM level — the old "INET Admin" bar.
PM_LEVEL_ROLES = frozenset({
    "Administrator", "System Manager", "INET Admin", "INET PM",
})

#: Roles that may approve a PM's request. INET PM is deliberately absent.
ADMIN_ROLES = frozenset({"Administrator", "System Manager", "INET Admin"})

#: Who receives the notifications that used to go to "INET Admin" alone. A PM
#: got them before the split because they held the role; losing them would be
#: a silent regression, so both are named. Not a permission set — ordering and
#: duplicates do not matter, _notify_role de-dupes by user.
ADMIN_NOTIFY_ROLES = ("INET Admin", "INET PM")


def roles_of(user=None):
    """The role set for a user, defaulting to the session user."""
    return set(frappe.get_roles(user or frappe.session.user))


def is_admin(user=None):
    """True for a real admin. Holding INET PM as well does not take it away.

    ``INET Admin`` is what grants admin. ``INET PM`` is a marker that reduces
    the sidebar, and it only means "this person is not an admin" when it is the
    ONLY one of the two they hold — which is now the normal case, since nothing
    pairs them automatically any more. Someone deliberately given both roles is
    an admin who happens to be tagged a PM, and may approve.

    ``Administrator`` and ``System Manager`` always qualify: someone with desk
    access already holds every key the portal could withhold.
    """
    return bool(roles_of(user) & ADMIN_ROLES)


def is_pm_only(user=None):
    """True for a PM who is not an admin — the ones an approval is for.

    This is also the sidebar's rule: a PM-only account loses Switch to Desk,
    Masters and the Certificate Tracker. Someone holding INET Admin too keeps
    all three, because they really are an admin.
    """
    return "INET PM" in roles_of(user) and not is_admin(user)
