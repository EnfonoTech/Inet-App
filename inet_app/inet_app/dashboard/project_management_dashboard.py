from inet_app.api.project_management import dashboard_charts, get_project_kpis


def get_dashboard_data():
    return {
        "kpis": get_project_kpis(),
        "charts": dashboard_charts(),
    }
