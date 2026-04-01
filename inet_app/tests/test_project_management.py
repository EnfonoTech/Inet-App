import frappe
from frappe.tests.utils import FrappeTestCase


class TestProjectManagement(FrappeTestCase):
    def test_project_completion_validation(self):
        doc = frappe.get_doc(
            {
                "doctype": "Project Control Center",
                "project_code": "PRJ-TEST-001",
                "project_name": "Test Project",
                "completion_percentage": 101,
            }
        )
        self.assertRaises(frappe.ValidationError, doc.insert)

    def test_team_assignment_utilization_validation(self):
        project = frappe.get_doc(
            {
                "doctype": "Project Control Center",
                "project_code": "PRJ-TEST-002",
                "project_name": "Utilization Project",
                "completion_percentage": 10,
            }
        ).insert(ignore_if_duplicate=True)

        assignment = frappe.get_doc(
            {
                "doctype": "Team Assignment",
                "team_id": "TEAM-001",
                "project": project.name,
                "assignment_date": "2026-04-01",
                "utilization_percentage": 150,
            }
        )
        self.assertRaises(frappe.ValidationError, assignment.insert)
