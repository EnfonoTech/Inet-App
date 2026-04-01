from inet_app.api.project_management import capture_gps_location


def test_capture_gps_location():
    location = capture_gps_location(24.7136, 46.6753)
    assert location == "24.7136,46.6753"
