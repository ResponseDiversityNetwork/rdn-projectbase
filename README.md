# RDN Projects

A public register of **response diversity projects**, run by the Response Diversity Network (RDN). Anyone can list a project (RDN member or not), at any stage from a first idea to a published paper. Anyone can browse the list to find collaborators, data or related work.

- **Browse:** https://responsediversitynetwork.github.io/rdn-projectbase/
- **Share a project:** use the online form linked from the site's *Share a project* page. You don't need a GitHub account.
- **Update a project:** use the personal update link in your confirmation email. It opens the form with your answers filled in.

This is a register, not a project-management tool. Each entry records what the project is, its stage, and how to get involved.

## How it works

```
Google Form ──► Apps Script ──► pull request adding/updating projects/<id>.yml
   ▲                │                         │
   │                │ emails lead their       ├─ new project      → curator reviews & merges
   │                │ personal update link    ├─ verified update  → merged automatically
   │                ▼                         └─ changed email / removal → curator reviews
   └──── personal update link (pre-filled form)
                                              ▼
                         GitHub Actions: validate → build pages → Quarto site on GitHub Pages
```

| Path | What it is |
|---|---|
| `projects/` | One YAML file per project (`rdn-YYYY-NNN.yml`). This is the data. |
| `schema/project.schema.json` | The fields and allowed values for project files. |
| `apps-script/` | Google Apps Script that builds the form, handles submissions, and sends emails and annual reminders. |
| `scripts/build_site.py` | Validates project files and generates one page per project. |
| `site/` | The Quarto website (browse, share, about pages). |
| `.github/workflows/` | Validation, auto-merging of verified updates, and site publishing. |
| `docs/SETUP.md` | One-off setup and the curators' routine. |

## Editing directly on GitHub

If you're comfortable with GitHub, you can edit your project's file in `projects/` and open a pull request. A curator will merge it. If the lead later updates the entry through the form, the form version replaces the file.

## Privacy

Lead email addresses and personal update links are kept only in the curators' private Google Sheet, unless a lead chooses to show their email. Minimal listings store only the title, lead and stage in this repository. Git keeps the history of every file. If you need an entry removed from that history too, ask the curators.

## Acknowledgements

Modelled on the [EFI project register](https://github.com/eco4cast/efi-projects).
