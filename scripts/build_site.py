#!/usr/bin/env python3
"""Validate project YAML files and generate the Quarto pages for the browse site.

Usage:
    python scripts/build_site.py --check   # validate only (used on pull requests)
    python scripts/build_site.py           # validate, then write site/projects/*.qmd
                                           # and site/data/projects.json

Run from the repository root.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
SCHEMA_PATH = ROOT / "schema" / "project.schema.json"
SITE_DIR = ROOT / "site"
OUT_DIR = SITE_DIR / "projects"
DATA_DIR = SITE_DIR / "data"

# Short labels used as Quarto categories (clickable filters on the listing page).
STAGE_SHORT = {
    "Idea - gauging interest": "Stage: idea",
    "Seeking collaborators": "Stage: seeking collaborators",
    "In progress - open to collaborators": "Stage: in progress (open)",
    "In progress - team set": "Stage: in progress (team set)",
    "In review": "Stage: in review",
    "Published": "Stage: published",
    "Inactive": "Stage: inactive",
}
OPEN_STAGES = {
    "Idea - gauging interest",
    "Seeking collaborators",
    "In progress - open to collaborators",
}


def load_projects() -> list[tuple[Path, dict]]:
    out = []
    for path in sorted(PROJECTS_DIR.glob("*.yml")):
        with path.open(encoding="utf-8") as fh:
            out.append((path, yaml.safe_load(fh) or {}))
    return out


def validate(projects: list[tuple[Path, dict]]) -> list[str]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []
    seen: dict[str, Path] = {}
    for path, data in projects:
        # YAML parses unquoted dates as date objects; normalise to strings.
        for key in ("created", "updated"):
            if key in data and not isinstance(data[key], str):
                data[key] = str(data[key])
        for err in validator.iter_errors(data):
            loc = "/".join(str(p) for p in err.absolute_path) or "(root)"
            errors.append(f"{path.name}: {loc}: {err.message}")
        pid = data.get("id")
        if pid and path.stem != pid:
            errors.append(f"{path.name}: file name must be '{pid}.yml'")
        if pid in seen:
            errors.append(f"{path.name}: duplicate id '{pid}' (also in {seen[pid].name})")
        elif pid:
            seen[pid] = path
    for path in PROJECTS_DIR.iterdir():
        if path.is_file() and path.suffix != ".yml" and path.name != ".gitkeep":
            errors.append(f"{path.name}: unexpected file in projects/ (use .yml)")
    return errors


def esc(s: str) -> str:
    """Neutralise raw HTML in user-supplied text (entries can be auto-merged)."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def yaml_str(s: str) -> str:
    """Quote a string safely for YAML front matter."""
    return json.dumps(s, ensure_ascii=False)


def bullet_list(items: list[str]) -> str:
    return "\n".join(f"- {i}" for i in items)


def render_page(p: dict, contact_email: str) -> str:
    full = p["listing"] == "full"
    stage = p["stage"]
    categories = [STAGE_SHORT[stage]]
    if stage in OPEN_STAGES:
        categories.append("Open to collaborators")
    if full:
        categories += p.get("response_diversity", [])
        categories += p.get("approaches", [])
        categories += p.get("organisms", [])
        categories += p.get("ecosystems", [])
    categories = [c for c in categories if c != "Other"]

    lead = p["lead"]
    summary = p.get("summary", "") if full else ""

    fm = [
        "---",
        f"title: {yaml_str(esc(p['title']))}",
        f"author: {yaml_str(esc(lead['name']))}",
        f"date: {p['updated']}",
        f"stage: {yaml_str(stage)}",
        f"project-id: {yaml_str(p['id'])}",
        "categories:",
        *[f"  - {yaml_str(c)}" for c in categories],
        "---",
        "",
    ]

    body: list[str] = []
    meta = [f"**Project ID:** `{p['id']}`", f"**Stage:** {stage}"]
    lead_line = esc(lead["name"])
    if lead.get("institution"):
        lead_line += f", {esc(lead['institution'])}"
    if lead.get("orcid"):
        lead_line += f" ([ORCID](https://orcid.org/{lead['orcid']}))"
    meta.append(f"**Lead:** {lead_line}")
    meta.append(f"**First listed:** {p['created']}")
    body.append("  \n".join(meta))
    body.append("")

    if full:
        body += ["## Summary", "", esc(summary.strip()), ""]
        facets = [
            ("Response diversity", p.get("response_diversity")),
            ("Organisms", p.get("organisms")),
            ("Ecosystems", p.get("ecosystems")),
            ("Approaches", p.get("approaches")),
        ]
        rows = [(k, esc(", ".join(v))) for k, v in facets if v]
        if p.get("drivers"):
            rows.append(("Drivers / disturbances", esc(p["drivers"])))
        if p.get("timeline"):
            rows.append(("Timeline", esc(p["timeline"])))
        if rows:
            body += ["## At a glance", "", "| | |", "|---|---|"]
            body += [f"| {k} | {v.replace('|', '/')} |" for k, v in rows]
            body.append("")
        if p.get("contributions_sought"):
            body += ["## Contributions sought", "", bullet_list([esc(c) for c in p["contributions_sought"]]), ""]
        if p.get("authorship_guidelines"):
            body += ["## Authorship", "", esc(p["authorship_guidelines"].strip()), ""]
        if p.get("links"):
            body += ["## Links", "", bullet_list([f"<{u}>" for u in p["links"]]), ""]

    body += ["## Get involved", ""]
    if lead.get("email"):
        body.append(f"Contact the project lead at <{lead['email']}>.")
    else:
        body.append(
            f"Email the RDN project curators at <{contact_email}>, quoting project ID "
            f"`{p['id']}`, and we will put you in touch with the project lead."
        )
    body.append("")
    return "\n".join(fm + body)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only")
    args = ap.parse_args()

    projects = load_projects()
    errors = validate(projects)
    if errors:
        print("Validation failed:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"OK: {len(projects)} project file(s) valid.")
    if args.check:
        return 0

    variables = yaml.safe_load((SITE_DIR / "_variables.yml").read_text(encoding="utf-8"))
    contact_email = variables.get("curator_email", "")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    public = []
    for _, p in projects:
        (OUT_DIR / f"{p['id']}.qmd").write_text(render_page(p, contact_email), encoding="utf-8")
        public.append(p)
    (DATA_DIR / "projects.json").write_text(
        json.dumps(public, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Wrote {len(public)} page(s) to {OUT_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
