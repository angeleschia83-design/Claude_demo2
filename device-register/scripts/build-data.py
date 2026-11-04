#!/usr/bin/env python3
"""Turn the IT Hardware Asset Management workbook into the two CSVs the
importer reads.

Device assignment comes from ONE place: the "Asset Central Inventory" tab,
rows whose Asset Status starts with "Active/ Assigned" and whose Asset Type is
Laptop, Imac or iPad. The "Asset Central Inventory (2)" tab is deliberately
ignored: its assignee names were sorted independently of the serial numbers,
so they no longer line up with the hardware.

"MONITORING_EMPLOYEES" is used only to look a job title up by name, which is
what decides Sales vs HO. A holder whose name is not found there is Unknown.

Usage:  python3 scripts/build-data.py <workbook.xlsx> [out_dir]
"""
import collections
import csv
import datetime
import difflib
import pathlib
import re
import sys
import unicodedata

import openpyxl

INVENTORY = "Asset Central Inventory"
EMPLOYEES = "MONITORING_EMPLOYEES"
LAPTOP_TYPES = {"Laptop", "Imac"}
IPAD_TYPES = {"iPad"}
ACTIVE = "Active/ Assigned"
SALES_TITLE = "financial advisor"      # the job title that means a field seller
NULLS = {"", "none", "not found", "n/a", "na", "-", "nan", "tbd"}


def clean(value):
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in NULLS else text


def ascii_fold(text):
    return unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()


def norm(text):
    return re.sub(r"[^a-z]", "", ascii_fold(text).lower())


def tokens(text):
    return [t for t in re.split(r"[^a-z]+", ascii_fold(text).lower()) if t]


def date_str(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.strftime("%Y-%m-%d")
    return clean(value)


def read_devices(book):
    """Every laptop, iMac and iPad currently assigned to a named person."""
    sheet = book[INVENTORY]
    out = []
    for row in sheet.iter_rows(min_row=3, values_only=True):
        serial, asset_type, status, last = clean(row[9]), clean(row[6]), clean(row[17]), clean(row[18])
        if not serial or not last or asset_type not in LAPTOP_TYPES | IPAD_TYPES:
            continue
        if not status.startswith(ACTIVE):
            continue
        out.append({
            "serial": serial,
            "kind": "Laptop" if asset_type in LAPTOP_TYPES else "iPad",
            "model": clean(row[7]) or "Model not recorded",
            "specs": clean(row[8]),
            "host_name": clean(row[10]),
            "os": clean(row[11]),
            "last": last,
            "given": clean(row[19]),
            "assigned_on": date_str(row[20]),
            "remarks": clean(row[21]),
            "age_years": round(float(row[5]), 1) if isinstance(row[5], (int, float)) else "",
        })
    return out


def read_employees(book):
    sheet = book[EMPLOYEES]
    out = []
    for row in sheet.iter_rows(min_row=4, values_only=True):
        if not any(cell not in (None, "") for cell in row):
            continue
        out.append({
            "last": clean(row[1]), "given": clean(row[2]), "position": clean(row[5]),
            "division": clean(row[6]), "department": clean(row[7]), "unit": clean(row[8]),
            "ad_id": clean(row[9]), "email": clean(row[10]),
        })
    return out


def make_lookup(employees):
    """Resolve an inventory name to an employee, in three widening tiers.

    Each tier only answers when exactly one employee fits, so an ambiguous
    surname is left Unknown rather than guessed at.
    """
    by_last = collections.defaultdict(list)
    by_full = collections.defaultdict(list)
    for person in employees:
        by_last[norm(person["last"])].append(person)
        by_full[(norm(person["last"]), norm(person["given"]))].append(person)

    def lookup(last, given):
        exact = by_full.get((norm(last), norm(given)), [])
        if len(exact) == 1:
            return exact[0], "exact name"

        candidates = by_last.get(norm(last), [])
        first = tokens(given)[:1]
        same_first = [p for p in candidates if first and tokens(p["given"])[:1] == first]
        if len(same_first) == 1:
            return same_first[0], "first name"

        scored = sorted(
            ((difflib.SequenceMatcher(None, norm(given), norm(p["given"])).ratio(), p) for p in candidates),
            key=lambda pair: -pair[0],
        )
        if scored and scored[0][0] >= 0.82 and (len(scored) == 1 or scored[0][0] - scored[1][0] > 0.1):
            return scored[0][1], "spelling"
        return None, "not found"

    return lookup


def build(workbook_path, out_dir):
    book = openpyxl.load_workbook(workbook_path, data_only=True, read_only=True)
    devices = read_devices(book)
    lookup = make_lookup(read_employees(book))

    by_holder = collections.OrderedDict()
    for device in devices:
        by_holder.setdefault((norm(device["last"]), norm(device["given"])), []).append(device)

    people = []
    for index, (_, kit) in enumerate(sorted(by_holder.items())):
        last, given = kit[0]["last"], kit[0]["given"]
        employee, source = lookup(last, given)
        laptops = [d for d in kit if d["kind"] == "Laptop"]
        ipads = [d for d in kit if d["kind"] == "iPad"]

        if employee is None:
            employee_type = "Unknown"
        elif SALES_TITLE in employee["position"].lower():
            employee_type = "Sales"
        else:
            employee_type = "HO"

        holder_id = f"P{index:03d}"
        for device in kit:
            device["holder_id"] = holder_id
            device["holder"] = " ".join(f"{given} {last}".split())

        people.append({
            "id": holder_id,
            "name": " ".join(f"{given} {last}".split()) or "(unnamed)",
            "employee_type": employee_type,
            "device_status": "Both" if laptops and ipads else ("Laptop only" if laptops else "iPad only"),
            "position": employee["position"] if employee else "",
            "department": employee["department"] if employee else "",
            "unit": (employee["unit"] or "") if employee else "",
            "division": employee["division"] if employee else "",
            "ad_id": employee["ad_id"] if employee else "",
            "email": employee["email"] if employee else "",
            "laptops_held": len(laptops),
            "ipads_held": len(ipads),
            "devices_held": len(kit),
            "laptop_serial": "; ".join(sorted(d["serial"] for d in laptops)),
            "laptop_model": "; ".join(sorted({d["model"] for d in laptops})),
            "ipad_serial": "; ".join(sorted(d["serial"] for d in ipads)),
            "ipad_model": "; ".join(sorted({d["model"] for d in ipads})),
            "remarks": "; ".join(sorted({d["remarks"] for d in kit if d["remarks"]})),
            "label_source": source,
        })

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    people_cols = list(people[0].keys())
    with (out / "people.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=people_cols)
        writer.writeheader()
        writer.writerows(people)

    device_cols = ["serial", "kind", "model", "holder_id", "holder", "assigned_on",
                   "age_years", "os", "host_name", "specs", "remarks"]
    with (out / "devices.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=device_cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(devices)

    counts = collections.Counter(p["employee_type"] for p in people)
    print(f"{len(people)} holders -> {out / 'people.csv'}")
    print(f"{len(devices)} devices -> {out / 'devices.csv'}")
    print("  " + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    unresolved = sum(1 for p in people if p["label_source"] == "not found")
    if unresolved:
        print(f"  {unresolved} holders have no job title and start as Unknown")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "data")
