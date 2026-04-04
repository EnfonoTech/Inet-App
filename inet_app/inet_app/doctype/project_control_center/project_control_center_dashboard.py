from frappe import _


def get_data():
    return {
        "fieldname": "project",
        "transactions": [{"label": _("Project Management"), "items": ["Daily Work Update", "Team Assignment"]}],
    }
