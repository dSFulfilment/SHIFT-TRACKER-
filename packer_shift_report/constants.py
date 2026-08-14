"""Hard-coded SKU targets for Dandenong South. Not present in any export file."""

# Primary Sku → (Target BPH, Strike line BPH)
SKU_TARGETS = {
    125: (17.0, 15.7),
    150: (18.0, 16.3),
    200: (17.0, 15.3),
    250: (16.0, 14.6),
    300: (18.0, 16.0),
    400: (16.0, 14.6),
    500: (23.0, 20.6),
    600: (20.0, 17.8),
    700: (21.0, 19.0),
}

FACILITY_NAME = "Dandenong South"

# Changeover / setup noise — packer+SKU lines under this are not real performance.
# Example: switching SKUs often packs 1–2 boxes slowly right after the switch.
MIN_HOURS_ON_SKU = 0.25  # 15 minutes

BOXES_REQUIRED_COLUMNS = [
    "Report Date",
    "Shift",
    "Pnp Worker Name",
    "Station Name",
    "Primary Sku",
    "Boxes Packed",
    "Items Packed",
    "Pouches Packed",
    "Packing Time Seconds",
    "Seconds per Item",
    "Pouches per Hour",
]

INTRA_REQUIRED_COLUMNS = [
    "Report Date Hour",
    "Pnp Worker Name",
    "Boxes Packed",
]

