# Setup and curation guide

Setup takes about an hour. It needs: admin rights on the RDN GitHub organisation, and a Google account that belongs to RDN rather than to one person (so the form, sheet and emails survive changes of organiser).

## 1. GitHub repository

1. Create `rdn-projectbase` in the `ResponseDiversityNetwork` organisation (public) and push this folder to it.
2. The organisation (`ResponseDiversityNetwork`) and repository (`rdn-projectbase`) names are already filled in. If either changes, search for them in `README.md`, `site/_quarto.yml`, `site/_variables.yml`, `schema/project.schema.json` and `apps-script/Code.gs`.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Settings → Actions → General → Workflow permissions: Read and write permissions.**
5. Create the labels used by the pipeline:
   ```sh
   gh label create new-project     --color 0E8A16 --description "New project from the form - curator review"
   gh label create verified-update --color 1D76DB --description "Update via personal link - auto-merged"
   gh label create needs-review    --color D93F0B --description "Needs curator check (e.g. email changed)"
   gh label create removal         --color B60205 --description "Lead asked to remove the listing"
   ```
6. **Branch protection (optional).** If you require reviews on `main`, auto-merging verified updates will fail. Either don't require reviews, or let the `github-actions` app bypass the rule (a ruleset with a bypass list).
7. **Create a token for the form script.**
   - Make a fine-grained personal access token (Settings → Developer settings → Fine-grained tokens), ideally on a dedicated RDN bot account.
     - **Resource owner:** the RDN org. The org may need to allow fine-grained tokens first.
     - **Repository access:** `rdn-projectbase` only.
     - **Permissions:** *Contents*, *Pull requests* and *Issues*, each set to read & write.
   - Tokens expire, so put the expiry date in the curators' calendar.

## 2. Google Form and Apps Script

1. Signed in as the RDN Google account, go to <https://script.google.com> and create a **New project** called "RDN Projects".
2. Paste `apps-script/Code.gs` into `Code.gs`.
3. **Project Settings:** tick *Show "appsscript.json" manifest file*, then paste in `apps-script/appsscript.json`.
4. **Project Settings → Script properties:** add
   | Property | Example |
   |---|---|
   | `GITHUB_TOKEN` | the token from step 1.7 |
   | `GITHUB_REPO` | `ResponseDiversityNetwork/rdn-projectbase` |
   | `GITHUB_BRANCH` | `main` |
   | `CURATOR_EMAIL` | `projects@…` (comma-separate several addresses) |
   | `SITE_URL` | `https://responsediversitynetwork.github.io/rdn-projectbase/` |
5. Select `setup` in the function menu and click **Run**, then authorise when asked. The log prints the form's edit and public URLs, and the URL of the private registry sheet.
   - `setup()` creates the form, a private spreadsheet (a `registry` tab, a `log` tab and the raw form responses), a submit trigger, and a weekly reminder trigger.
6. Put the form's public URL (or its `forms.gle` short link) and the curator email into `site/_variables.yml`, then commit. The site rebuilds automatically.
7. Share the form and the registry sheet with the other curators (as editors), and keep the sheet private.

To change form wording later, edit the form directly in Google Forms. **Do not rename questions or choices** without also changing `ITEMS`/`FORM_CHOICES` in `Code.gs` and `schema/project.schema.json`, because the script matches answers by question title. New choices must be added in all three places.

## 3. Test before launch

Use your own email address:

| Test | Expected |
|---|---|
| Submit the form | Email with project ID and update link; PR labelled `new-project`; curator email; new row in `registry` |
| Merge the PR | Site shows the project within ~2 minutes (Actions → Publish site) |
| Open the update link, change the stage, submit | PR labelled `verified-update` merges itself; the site updates; **no new row** in `registry` |
| Use the update link but change the email | PR labelled `needs-review`; email to both old and new address |
| Use the update link and tick "remove" | PR labelled `removal` that deletes the file |
| Choose a minimal listing | YAML contains only title, lead, stage and dates |
| Run `sendAnnualReminders` after setting a row's `updated` to last year | Reminder email; `last_reminder` filled in |

Then delete the two `EXAMPLE` files in `projects/`, plus the test entries (and their rows in `registry`).

Run the checks locally:

```sh
pip install -r scripts/requirements.txt
python scripts/build_site.py          # validate + generate pages
quarto preview site                   # browse locally
```

## 4. Curators' routine

**Weekly (about 10 minutes)**

- Review open PRs labelled `new-project`, `needs-review` or `removal`.
  - **New projects:** check the entry is about response diversity and not spam. Fix obvious typos in the PR if needed, then merge. Contact the lead rather than rejecting silently.
  - **`needs-review`:** if the email change is genuine, merge the PR and update `lead_email` in the `registry` sheet.
  - **`removal`:** merge, and set the registry `status` to `removed`.
- Check your inbox for "error processing a submission" emails. The raw answers are always kept in the responses tab, so nothing is lost; fix the cause, then add the entry by hand or ask the lead to resubmit.

**Requests by email**

- *Lost the update link:* find the row in `registry` (`edit_url`) and send the link to the email address on file. Never send it to a different address.
- *Remove the entry from Git history as well:* delete the file, then rewrite history with `git filter-repo` (or ask GitHub Support). Rarely needed.

**Yearly**

- Renew the GitHub token before it expires.
- Mark entries `Inactive` if the lead didn't respond to two reminders and nothing has changed.
- Share the year's list in the RDN newsletter or at a meeting.

## How the update link works

The update link is the Google Forms *edit response* URL. Anyone holding it can edit that entry, so it acts like a password. It's sent only to the lead's email and stored only in the private sheet. Because a submission made through it has the same response ID, the script knows which project it belongs to. If the email address is unchanged, the update is published automatically; if it changed, a curator reviews it.
