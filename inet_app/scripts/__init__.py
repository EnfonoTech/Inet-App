"""One-off maintenance scripts, run by hand with ``bench execute``.

Nothing here is wired into hooks or patches: these are corrections to one
site's data, run deliberately and usually once.
"""

import functools

import frappe


def bench_safe(fn):
    """Print the real traceback before ``bench execute`` hides it.

    ``bench execute`` calls ``frappe.get_attr(method)(*args, **kwargs)`` and, on
    *any* exception, silently retries via ``eval(method + "(...)")`` — which
    fails with ``NameError: name 'inet_app' is not defined`` and reports that
    instead (frappe/commands/utils.py). So a genuine failure inside a script
    surfaces as a message about the module not existing, on a machine we
    generally cannot attach a debugger to.

    Every entry point in this package that is meant to be reached through
    ``bench execute`` wears this, so what actually went wrong is on screen
    before the framework's misleading second attempt runs.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            print("\n" + frappe.get_traceback())
            raise
    return wrapper
