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

## Who runs it

The register is run by two roles. One person can hold both, but having two people means someone else can step in when one is away. Contact both through the curator email on the site's *Share a project* page.

| Role | Current | Needs access to |
|---|---|---|
| **Curator** | TBD | Write access to this repository; editor on the registry sheet and the form |
| **Admin** | Owen Petchey | Admin on this repository; the shared RDN account, which owns the form, sheet and Apps Script and is also the GitHub bot account |

### Curator

Looks after the content: what gets listed, and helping leads. About 10 minutes a week. The full routine is in [`docs/SETUP.md`](docs/SETUP.md#4-curators-routine).

Common tasks:

- **Review new projects** (PRs labelled `new-project`). Check the entry is about response diversity and isn't spam, fix obvious typos, then merge. If something needs changing, contact the lead rather than closing silently.
- **Check new tags.** New tags are flagged in the PR notes. If one duplicates an existing tag, fix it in the PR before merging. If validation fails because two projects spell a tag differently, pick one spelling and correct the other file.
- **Handle email changes** (`needs-review`). If the change is genuine, merge and update `lead_email` in the registry sheet.
- **Handle removals** (`removal`). Merge, and set `status` to `removed` in the registry sheet.
- **Answer leads' emails.** Resend a lost update link (from `edit_url` in the registry sheet), only ever to the address on file.
- **Act on error emails.** "Error processing a submission" means the answers are safe in the responses tab. Add the entry by hand or ask the lead to resubmit, and tell the admin if the cause looks technical.
- **Once a year:** mark entries `Inactive` if the lead didn't answer two reminders, and share the year's list in the RDN newsletter or at a meeting.

### Admin

Looks after the machinery: accounts, tokens, code and settings. Usually only a few hours a year, plus fixing things when they break.

Common tasks:

- **Keep the shared account safe.** Losing it locks out both the Google side and the GitHub bot. Keep its recovery details and 2FA backup codes where a second organiser can reach them, and update them when organisers change.
- **Renew the GitHub token(s)** before they expire (the expiry dates should be in the organisers' calendar). After renewing, paste the new token into the Apps Script property `GITHUB_TOKEN`, and get it approved under the org's *Settings → Personal access tokens → Pending requests*. Renew `WEBSITE_DISPATCH_TOKEN` too if it's in use.
- **Change the form.** Wording can be edited in Google Forms. Renaming a question or adding a choice also needs changes in `Code.gs` (`ITEMS`/`FORM_CHOICES`) and `schema/project.schema.json`; see [`docs/SETUP.md`](docs/SETUP.md#2-google-form-and-apps-script).
- **Deploy code changes.** Push changes to the repository, and paste any new `Code.gs` into Apps Script (it isn't synced automatically). Check the triggers still exist: one on form submit, one weekly for reminders.
- **Fix failed builds.** If *Actions → Validate* or *Publish site* fails on `main`, find the cause and fix it, or ask the curator to correct the project file.
- **Maintain settings.** Site settings in `site/_variables.yml` (form link, curator email); the `CURATOR_EMAIL` script property; repository labels, Pages and Actions settings.
- **Hand over.** When a curator or admin changes, update the table above, the sharing of the form and sheet, repository access, `CURATOR_EMAIL`, and who holds the shared account's recovery details.

## Editing directly on GitHub

If you're comfortable with GitHub, you can edit your project's file in `projects/` and open a pull request. A curator will merge it. If the lead later updates the entry through the form, the form version replaces the file.

## Privacy

Lead email addresses and personal update links are kept only in the curators' private Google Sheet, unless a lead chooses to show their email. Minimal listings store only the title, lead and stage in this repository. Git keeps the history of every file. If you need an entry removed from that history too, ask the curators.

## Acknowledgements

Modelled on the [EFI project register](https://github.com/eco4cast/efi-projects).
