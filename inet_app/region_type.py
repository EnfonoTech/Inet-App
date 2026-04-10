"""Region type derived from center/area text (PO and project masters)."""


def region_type_from_center_area(center_area):
    """Hard if the text contains 'hard' (case-insensitive); otherwise Standard."""
    if not center_area:
        return "Standard"
    return "Hard" if "hard" in str(center_area).lower() else "Standard"


def is_hard_region(region_type, center_area):
    """True if region_type is Hard, or (legacy) center_area contains 'hard'."""
    rt = (region_type or "").strip()
    if rt == "Hard":
        return True
    if rt == "Standard":
        return False
    return "hard" in (center_area or "").lower()
