from frappe import _


def get_data():
    return {
        "fieldname": "project_code",
        "transactions": [{"label": _("Project Management"), "items": ["Daily Work Update", "Team Assignment"]}],
    }
