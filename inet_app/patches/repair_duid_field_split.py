"""Move DUID values stranded by the accounting/inventory dimension split.

The real work lives in ``inet_app.setup._migrate_stranded_duid_values`` and is
invoked from ``_separate_duid_dimensions`` during ``after_migrate``, because
that is the only phase where the ordering is guaranteed: post_model_sync
patches run *before* after_migrate hooks, so on a site whose rename happens
during this same migrate a patch would run first, find nothing to repair, and
be recorded as executed forever.

Kept as a registered patch so the repair still happens on a site that has
already been renamed by an earlier deploy, and so the intent is visible in
patches.txt. Idempotent and safe to no-op.
"""
import frappe

from inet_app.setup import _migrate_stranded_duid_values


def execute():
    moved = _migrate_stranded_duid_values()
    print(f"repair_duid_field_split: {moved} row(s) migrated")
