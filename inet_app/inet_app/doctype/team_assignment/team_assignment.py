import frappe
from frappe import _
from frappe.model.document import Document


class TeamAssignment(Document):
    def validate(self):
        self._validate_dates()
        self._validate_utilization()
        self._prevent_overlapping_assignments()

    def _validate_dates(self):
        if self.end_date and self.assignment_date and self.end_date < self.assignment_date:
            frappe.throw(_("End Date cannot be before Assignment Date."))

    def _validate_utilization(self):
        value = float(self.utilization_percentage or 0)
        if value < 0 or value > 100:
            frappe.throw(_("Utilization Percentage must be between 0 and 100."))

    def _prevent_overlapping_assignments(self):
        if not (self.team_id and self.assignment_date):
            return
        query = """
            SELECT name
            FROM `tabTeam Assignment`
            WHERE team_id = %(team_id)s
              AND status = 'Active'
              AND name != %(name)s
              AND (
                (%(assignment_date)s BETWEEN assignment_date AND IFNULL(end_date, '2199-12-31'))
                OR (%(end_date)s BETWEEN assignment_date AND IFNULL(end_date, '2199-12-31'))
                OR (assignment_date BETWEEN %(assignment_date)s AND IFNULL(%(end_date)s, '2199-12-31'))
              )
            LIMIT 1
        """
        overlap = frappe.db.sql(
            query,
            {
                "team_id": self.team_id,
                "name": self.name or "",
                "assignment_date": self.assignment_date,
                "end_date": self.end_date or self.assignment_date,
            },
            as_dict=True,
        )
        if overlap:
            frappe.throw(_("Team {0} already has an overlapping active assignment ({1}).").format(self.team_id, overlap[0].name))
