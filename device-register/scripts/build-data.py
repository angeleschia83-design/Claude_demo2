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

Sales vs HO comes from HR's own Unit column when an employee list is given;
otherwise it falls back to reading the job title off MONITORING_EMPLOYEES.
A holder absent from the employee list is recorded as `not on list`, which is
the evidence for tagging them resigned in the app — the script never tags
anyone itself, because absence from an HR export is not proof of departure.

Usage:
  python3 scripts/build-data.py <asset-workbook.xlsx> [out_dir] [employee-list.xlsx]
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


def demojibake(text):
    """The HR export is UTF-8 read as latin-1 in places, so "Bañares" arrives
    as "BaÃ±ares". Repair that before folding, or the two spellings of one
    person never meet and they look like a leaver."""
    text = str(text or "")
    if "Ã" in text or "Â" in text:
        try:
            return text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return text


def ascii_fold(text):
    text = demojibake(text).replace("\ufffd", "")
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


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


def read_employee_list(path):
    """HR's staff export. Its Unit column is HR's own answer to the question
    the job-title rule only guesses at.

    A sheet named "Resigned" names people who have left, which is far better
    than inferring departure from absence: absence can equally mean a
    contractor, an agency seller or a shared machine. Where there is no such
    sheet every row is read as active and nobody is marked as having left."""
    book = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = []
    for sheet in book.worksheets:
        rows = sheet.iter_rows(values_only=True)
        try:
            head = [clean(cell) for cell in next(rows)]
        except StopIteration:
            continue
        if "Last Name" not in head or "First Name" not in head:
            continue
        index = {name: head.index(name) for name in head}
        left = sheet.title.strip().lower().startswith("resign")
        for row in rows:
            if not any(cell not in (None, "") for cell in row):
                continue
            last = clean(row[index["Last Name"]])
            given = clean(row[index["First Name"]])
            if not last and not given:
                continue
            out.append({
                "last": last, "given": given,
                "position": clean(row[index["Job Position"]]) if "Job Position" in index else "",
                "department": clean(row[index["Department"]]) if "Department" in index else "",
                "unit": clean(row[index["Unit"]]) if "Unit" in index else "",
                "resigned": left,
                "last_working_day": (
                    date_str(row[index["Last  Working Day"]]) if "Last  Working Day" in index
                    else date_str(row[index["Last Working Day"]]) if "Last Working Day" in index
                    else ""
                ),
            })
    if not out:
        raise SystemExit(f"{path} has no sheet with Last Name and First Name columns")
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

        # The inventory sometimes carries the two halves the wrong way round.
        swapped = by_full.get((norm(given), norm(last)), [])
        if len(swapped) == 1:
            return swapped[0], "name halves swapped"

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

        # Nobody shares the surname, so compare whole names against everyone.
        # Stricter, because this tier has every employee to be wrong about
        # instead of a handful.
        whole = norm(last) + norm(given)
        scored = sorted(
            ((difflib.SequenceMatcher(None, whole, norm(p["last"]) + norm(p["given"])).ratio(), p)
             for p in employees),
            key=lambda pair: -pair[0],
        )
        if scored and scored[0][0] >= 0.88 and (len(scored) == 1 or scored[0][0] - scored[1][0] > 0.06):
            return scored[0][1], "whole name"
        return None, "not found"

    return lookup


def build(workbook_path, out_dir, employee_list=None):
    book = openpyxl.load_workbook(workbook_path, data_only=True, read_only=True)
    devices = read_devices(book)
    lookup = make_lookup(read_employees(book))

    # HR's own Sales/HO flag beats reading a job title, so prefer it when the
    # employee list is supplied and keep the job title as the fallback for
    # anyone it does not list at all.
    hr_lookup = hr_left_lookup = None
    if employee_list:
        staff = read_employee_list(employee_list)
        # The active roll is searched first, so somebody who left and came
        # back reads as active rather than as the departure they returned from.
        hr_lookup = make_lookup([p for p in staff if not p["resigned"]])
        hr_left_lookup = make_lookup([p for p in staff if p["resigned"]])

    by_holder = collections.OrderedDict()
    for device in devices:
        by_holder.setdefault((norm(device["last"]), norm(device["given"])), []).append(device)

    people = []
    for index, (_, kit) in enumerate(sorted(by_holder.items())):
        last, given = kit[0]["last"], kit[0]["given"]
        employee, source = lookup(last, given)
        laptops = [d for d in kit if d["kind"] == "Laptop"]
        ipads = [d for d in kit if d["kind"] == "iPad"]

        hr, hr_source = hr_lookup(last, given) if hr_lookup else (None, "")
        if hr is None and hr_left_lookup is not None:
            hr, hr_source = hr_left_lookup(last, given)
        hr_status = "" if hr_lookup is None else (
            "resigned" if (hr and hr["resigned"]) else "active" if hr else "not on list")

        if hr is not None:
            employee_type = "Sales" if hr["unit"].lower() == "sales" else "HO"
            source = f"HR unit, {hr_source}"
        elif employee is None:
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
            "hr_status": hr_status,
            "resigned": "yes" if (hr and hr["resigned"]) else "",
            "last_working_day": (hr or {}).get("last_working_day", "") if (hr and hr["resigned"]) else "",
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
    unresolved = sum(1 for p in people if p["employee_type"] == "Unknown")
    if unresolved:
        print(f"  {unresolved} holders have no job title and start as Unknown")
    if employee_list:
        left = [p for p in people if p["hr_status"] == "resigned"]
        absent = [p for p in people if p["hr_status"] == "not on list"]
        if left:
            print(f"  {len(left)} holders are on HR's resigned list, holding "
                  f"{sum(p['devices_held'] for p in left)} devices to retrieve")
        print(f"  {len(absent)} holders are on neither HR sheet, holding "
              f"{sum(p['devices_held'] for p in absent)} devices")
        print("  Those are not tagged as having left: absence is not a resignation.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(
        sys.argv[1],
        sys.argv[2] if len(sys.argv) > 2 else "data",
        sys.argv[3] if len(sys.argv) > 3 else None,
    )
