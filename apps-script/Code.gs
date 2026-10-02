/**
 * RDN Projects — Google Apps Script back end.
 *
 * What it does
 *  - setup(): builds the Google Form and the private "registry" Google Sheet,
 *    and installs the triggers. Run ONCE by hand.
 *  - onProjectFormSubmit(e): runs on every submission AND every edit of a submission.
 *      new submission  -> assigns an ID, opens a pull request labelled "new-project"
 *                         (curator review), emails the lead their personal update link.
 *      edit via link   -> opens/updates a pull request labelled "verified-update"
 *                         (merged automatically once validation passes), or
 *                         "needs-review" if the email address was changed.
 *      removal request -> pull request deleting the file ("removal" label).
 *  - sendAnnualReminders(): weekly; emails leads whose entry hasn't changed for a year.
 *
 * The "personal update link" is the Google Forms edit-response URL. It opens the
 * form pre-filled with the lead's previous answers, needs no Google account, and
 * acts as a private key to that entry. It is stored only in the private sheet and
 * in emails to the lead.
 *
 * Script properties (Project Settings -> Script properties):
 *   GITHUB_TOKEN    fine-grained token: this repo only; Contents + Pull requests: read/write
 *   GITHUB_REPO     e.g. "ResponseDiversityNetwork/rdn-projectbase"
 *   GITHUB_BRANCH   default "main"
 *   CURATOR_EMAIL   address that receives review notifications (comma-separated allowed)
 *   SITE_URL        e.g. "https://responsediversitynetwork.github.io/rdn-projectbase/"
 *   FORM_ID, SHEET_ID  written by setup()
 *
 * Keep FORM_CHOICES in sync with schema/project.schema.json.
 */

// ---------------------------------------------------------------- form definition

var FORM_CHOICES = {
  response_diversity: [
    'Response traits / functional response diversity',
    'Temporal (asynchrony, timing of responses)',
    'Spatial',
    'Intraspecific / genetic',
    'Across levels of organisation',
    'Conceptual / definitions',
    'Other'
  ],
  organisms: [
    'Microbes', 'Phytoplankton / algae', 'Plants', 'Invertebrates', 'Vertebrates',
    'Fungi', 'Multiple / whole communities', 'Not organism-specific', 'Other'
  ],
  ecosystems: [
    'Terrestrial', 'Freshwater', 'Marine', 'Agricultural', 'Urban',
    'Laboratory / mesocosm', 'Not ecosystem-specific', 'Other'
  ],
  approaches: [
    'Theory / modelling', 'Laboratory or mesocosm experiment', 'Field experiment',
    'Observational / monitoring data', 'Synthesis / meta-analysis', 'Methods / software',
    'Data compilation', 'Applied / management', 'Other'
  ],
  stage: [
    'Idea - gauging interest',
    'Seeking collaborators',
    'In progress - open to collaborators',
    'In progress - team set',
    'In review',
    'Published',
    'Inactive'
  ],
  contributions_sought: [
    'Data', 'Analysis / statistics', 'Modelling / theory', 'Field or lab work',
    'Writing / editing', 'Specific system or taxon expertise', 'Funding / hosting', 'Other'
  ]
};

var LISTING_FULL = 'Full listing - show all details';
var LISTING_MINIMAL = 'Minimal listing - show only title, lead and stage';
var YES_SHOW_EMAIL = 'Yes, show my email address on the project page';
var CONSENT = 'I agree that the information I have provided (except my email address, unless I chose to show it) will be published on the RDN Projects website and stored in a public GitHub repository.';
var REMOVE = 'Please remove this project from the site';

// key, type, title, required, help, choices
var ITEMS = [
  { key: '_section_lead', type: 'section', title: 'About you (the project lead)' },
  { key: 'lead_name', type: 'text', title: 'Your name', required: true },
  { key: 'lead_email', type: 'email', title: 'Your email address', required: true,
    help: 'Kept private unless you choose to show it below. Used to send you your personal update link.' },
  { key: 'show_email', type: 'checkbox', title: 'Show email publicly?', choices: [YES_SHOW_EMAIL],
    help: 'If unticked, people contact the RDN curators, who put them in touch with you.' },
  { key: 'institution', type: 'text', title: 'Institution / organisation' },
  { key: 'orcid', type: 'text', title: 'ORCID iD', help: 'e.g. 0000-0002-1825-0097' },

  { key: '_section_project', type: 'section', title: 'The project' },
  { key: 'title', type: 'text', title: 'Project title', required: true },
  { key: 'summary', type: 'paragraph', title: 'Short summary', required: true,
    help: 'About 100-200 words: question, approach, and what you hope to produce.' },
  { key: 'response_diversity', type: 'checkbox', title: 'Which aspects of response diversity?',
    choices: FORM_CHOICES.response_diversity },
  { key: 'organisms', type: 'checkbox', title: 'Organisms', choices: FORM_CHOICES.organisms },
  { key: 'ecosystems', type: 'checkbox', title: 'Ecosystems', choices: FORM_CHOICES.ecosystems },
  { key: 'drivers', type: 'text', title: 'Environmental drivers / disturbances',
    help: 'e.g. warming, drought, pesticides, fishing' },
  { key: 'approaches', type: 'checkbox', title: 'Approach', choices: FORM_CHOICES.approaches },

  { key: '_section_status', type: 'section', title: 'Status and collaboration' },
  { key: 'stage', type: 'list', title: 'Stage', required: true, choices: FORM_CHOICES.stage },
  { key: 'contributions_sought', type: 'checkbox', title: 'Contributions sought (if any)',
    choices: FORM_CHOICES.contributions_sought },
  { key: 'authorship_guidelines', type: 'paragraph', title: 'How will authorship be decided?',
    help: 'Please state this if the project is open to collaborators. See https://credit.niso.org/ for contributor roles.' },
  { key: 'timeline', type: 'text', title: 'Expected timeline' },
  { key: 'links', type: 'paragraph', title: 'Links',
    help: 'One per line, starting with https:// (preprint, DOI, repository, data, project website).' },

  { key: '_section_publish', type: 'section', title: 'Publication on the site' },
  { key: 'listing', type: 'multiple', title: 'How much should be shown?', required: true,
    choices: [LISTING_FULL, LISTING_MINIMAL],
    help: 'A minimal listing publishes only the title, lead name/institution and stage. The other details are kept only by the RDN curators.' },
  { key: 'consent', type: 'checkbox', title: 'Consent', required: true, choices: [CONSENT] },
  { key: 'remove', type: 'checkbox', title: 'Remove listing (only when updating)', choices: [REMOVE],
    help: 'Tick only if you are using your update link and want the project taken off the site.' }
];

var REGISTRY_HEADERS = ['project_id', 'response_id', 'edit_url', 'lead_email', 'lead_name',
  'title', 'status', 'created', 'updated', 'last_reminder', 'branch', 'pr_url', 'notes'];

// ---------------------------------------------------------------- setup

function setup() {
  var props = PropertiesService.getScriptProperties();
  ['GITHUB_TOKEN', 'GITHUB_REPO', 'CURATOR_EMAIL', 'SITE_URL'].forEach(function (k) {
    if (!props.getProperty(k)) throw new Error('Set script property ' + k + ' before running setup().');
  });
  if (props.getProperty('FORM_ID')) throw new Error('setup() has already run (FORM_ID is set).');

  var form = FormApp.create('Share a response diversity project (RDN Projects)');
  form.setDescription(
    'List a response diversity project on the RDN Projects register (' + props.getProperty('SITE_URL') + '). ' +
    'Anyone may submit, at any stage. After submitting you will get an email with your personal link ' +
    'to update the entry later. Takes about 10 minutes.');
  form.setAllowResponseEdits(true);       // enables the personal update link
  form.setShowLinkToRespondAgain(false);
  try { form.setRequireLogin(false); } catch (err) { /* only applies to Workspace domains */ }
  form.setConfirmationMessage(
    'Thank you! Check your inbox for a confirmation email containing your personal update link. ' +
    'New entries are reviewed by an RDN curator before they appear on the site.');

  ITEMS.forEach(function (it) {
    var item;
    switch (it.type) {
      case 'section': item = form.addSectionHeaderItem(); break;
      case 'text': item = form.addTextItem(); break;
      case 'email':
        item = form.addTextItem();
        item.setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
        break;
      case 'paragraph': item = form.addParagraphTextItem(); break;
      case 'checkbox': item = form.addCheckboxItem().setChoiceValues(it.choices); break;
      case 'list': item = form.addListItem().setChoiceValues(it.choices); break;
      case 'multiple': item = form.addMultipleChoiceItem().setChoiceValues(it.choices); break;
    }
    item.setTitle(it.title);
    if (it.help) item.setHelpText(it.help);
    if (it.required && item.setRequired) item.setRequired(true);
  });

  var ss = SpreadsheetApp.create('RDN Projects registry (PRIVATE)');
  var reg = ss.getSheets()[0].setName('registry');
  reg.appendRow(REGISTRY_HEADERS);
  reg.setFrozenRows(1);
  var log = ss.insertSheet('log');
  log.appendRow(['timestamp', 'project_id', 'event', 'detail']);
  // Raw responses are also kept by Forms; linking makes them visible to curators.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  props.setProperty('FORM_ID', form.getId());
  props.setProperty('SHEET_ID', ss.getId());

  ScriptApp.newTrigger('onProjectFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('sendAnnualReminders').timeBased().everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  Logger.log('Form (edit):   ' + form.getEditUrl());
  Logger.log('Form (public): ' + form.getPublishedUrl());
  Logger.log('Registry:      ' + ss.getUrl());
}

// ---------------------------------------------------------------- submission handler

function onProjectFormSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    handleResponse_(e.response);
  } catch (err) {
    notifyCurator_('RDN Projects: error processing a submission',
      'Error: ' + err + '\n\n' + (err.stack || '') +
      '\n\nResponse ID: ' + (e && e.response ? e.response.getId() : '?'));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function handleResponse_(response) {
  var props = PropertiesService.getScriptProperties();
  var answers = parseResponse_(response);
  var responseId = response.getId();
  var editUrl = response.getEditResponseUrl();
  var today = isoDate_(new Date());
  var reg = registry_();
  var row = findRow_(reg, responseId, editUrl);

  var kind, projectId, created;
  if (!row) {
    projectId = nextProjectId_(reg);
    created = today;
    kind = 'new';
  } else {
    projectId = row.data.project_id;
    created = row.data.created || today;
    var sameEmail = normEmail_(row.data.lead_email) === normEmail_(answers.lead_email);
    kind = sameEmail ? 'verified-update' : 'needs-review';
  }
  var removal = !!row && answers.remove.length > 0;

  var path = 'projects/' + projectId + '.yml';
  var notes = [];
  var yaml = removal ? null : buildYaml_(projectId, answers, created, today, notes);

  // Re-use an open PR for this project if there is one, so edits don't conflict.
  var branch = null, prUrl = null, prNumber = null;
  if (row && row.data.branch) {
    var open = findOpenPr_(row.data.branch);
    if (open) { branch = row.data.branch; prUrl = open.html_url; prNumber = open.number; }
  }
  if (!branch) branch = 'submission/' + projectId + '-' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');

  var labels = [removal ? 'removal' : (kind === 'new' ? 'new-project' : kind)];
  if (removal && kind === 'verified-update') labels.push('verified-update');
  if (removal && kind === 'needs-review') labels.push('needs-review');

  var message = (removal ? 'Remove ' : (kind === 'new' ? 'Add ' : 'Update ')) + projectId + ' via form';
  var pr = commitAndPr_(branch, path, yaml, message, prNumber, labels, kind, projectId, answers, notes);
  prUrl = pr.html_url;

  var record = {
    project_id: projectId, response_id: responseId, edit_url: editUrl,
    lead_email: row && kind === 'needs-review' ? row.data.lead_email : answers.lead_email,
    lead_name: answers.lead_name, title: answers.title,
    status: removal ? 'removal-requested' : (kind === 'new' ? 'pending-review' : 'submitted'),
    created: created, updated: today,
    last_reminder: row ? row.data.last_reminder : '',
    branch: branch, pr_url: prUrl,
    notes: (row && row.data.notes ? row.data.notes + ' | ' : '') + notes.join('; ')
  };
  if (kind === 'needs-review') {
    record.notes += ' | email change requested to ' + answers.lead_email + ' on ' + today;
  }
  writeRow_(reg, row ? row.index : null, record);
  log_(projectId, kind + (removal ? '+removal' : ''), prUrl);

  emailLead_(kind, removal, projectId, answers, editUrl, row ? row.data.lead_email : null);
  if (kind !== 'verified-update') {
    notifyCurator_('RDN Projects: ' + labels.join(', ') + ' — ' + projectId,
      'Project: ' + answers.title + '\nLead: ' + answers.lead_name + '\n\nPull request: ' + prUrl +
      (notes.length ? '\n\nNotes: ' + notes.join('; ') : '') +
      (kind === 'needs-review' ? '\n\nThe lead email changed from ' + row.data.lead_email + ' to ' +
        answers.lead_email + '. Check before merging, then update the registry sheet.' : ''));
  }
}

// ---------------------------------------------------------------- parsing and YAML (pure functions)

function parseResponse_(response) {
  var byTitle = {};
  ITEMS.forEach(function (it) { byTitle[it.title] = it; });
  var a = {};
  ITEMS.forEach(function (it) {
    if (it.type === 'section') return;
    a[it.key] = it.type === 'checkbox' ? [] : '';
  });
  response.getItemResponses().forEach(function (ir) {
    var it = byTitle[ir.getItem().getTitle()];
    if (!it) return;
    var v = ir.getResponse();
    a[it.key] = it.type === 'checkbox' ? (v || []) : String(v || '').trim();
  });
  return a;
}

function buildYaml_(projectId, a, created, updated, notes) {
  var minimal = a.listing === LISTING_MINIMAL;
  var lines = [
    '# Written by the RDN Projects form. Edits via GitHub pull request are welcome,',
    '# but the next form update from the lead will overwrite this file.',
    'id: ' + q_(projectId),
    'title: ' + q_(a.title),
    'lead:',
    '  name: ' + q_(a.lead_name)
  ];
  if (a.institution) lines.push('  institution: ' + q_(a.institution));
  var orcid = normOrcid_(a.orcid);
  if (orcid) lines.push('  orcid: ' + q_(orcid));
  else if (a.orcid) notes.push('ORCID "' + a.orcid + '" not recognised and omitted');
  if (a.show_email && a.show_email.length) lines.push('  email: ' + q_(a.lead_email));

  if (!minimal) {
    lines.push('summary: ' + q_(a.summary));
    list_(lines, 'response_diversity', a.response_diversity);
    list_(lines, 'organisms', a.organisms);
    list_(lines, 'ecosystems', a.ecosystems);
    if (a.drivers) lines.push('drivers: ' + q_(a.drivers));
    list_(lines, 'approaches', a.approaches);
  }
  lines.push('stage: ' + q_(a.stage));
  if (!minimal) {
    list_(lines, 'contributions_sought', a.contributions_sought);
    if (a.authorship_guidelines) lines.push('authorship_guidelines: ' + q_(a.authorship_guidelines));
    if (a.timeline) lines.push('timeline: ' + q_(a.timeline));
    var links = [], bad = [];
    String(a.links || '').split(/[\r\n]+/).forEach(function (l) {
      l = l.trim();
      if (!l) return;
      if (/^www\./i.test(l)) l = 'https://' + l;
      if (/^10\.\d{4,}\//.test(l)) l = 'https://doi.org/' + l;
      (/^https?:\/\/\S+$/i.test(l) ? links : bad).push(l);
    });
    if (bad.length) notes.push('Links omitted (not URLs): ' + bad.join(', '));
    list_(lines, 'links', links);
  }
  lines.push('listing: ' + (minimal ? 'minimal' : 'full'));
  lines.push('created: ' + q_(created));
  lines.push('updated: ' + q_(updated));
  return lines.join('\n') + '\n';
}

/** JSON strings are valid YAML double-quoted scalars. */
function q_(s) { return JSON.stringify(String(s)); }

function list_(lines, key, arr) {
  if (!arr || !arr.length) return;
  lines.push(key + ':');
  arr.forEach(function (v) { lines.push('  - ' + q_(v)); });
}

function normOrcid_(s) {
  if (!s) return '';
  var m = String(s).toUpperCase().match(/(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dX])/);
  return m ? [m[1], m[2], m[3], m[4]].join('-') : '';
}

function normEmail_(s) { return String(s || '').trim().toLowerCase(); }

function isoDate_(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }

// ---------------------------------------------------------------- registry sheet

function registry_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  return ss.getSheetByName('registry');
}

function readRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  return values.slice(1).map(function (r, i) {
    var data = {};
    headers.forEach(function (h, j) {
      var v = r[j];
      data[h] = v instanceof Date ? isoDate_(v) : String(v);
    });
    return { index: i + 2, data: data };
  });
}

function findRow_(sheet, responseId, editUrl) {
  var rows = readRows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].data.response_id === responseId || (editUrl && rows[i].data.edit_url === editUrl)) return rows[i];
  }
  return null;
}

function nextProjectId_(sheet) {
  var year = new Date().getUTCFullYear();
  var max = 0;
  readRows_(sheet).forEach(function (r) {
    var m = r.data.project_id.match(/^rdn-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  return 'rdn-' + year + '-' + ('00' + (max + 1)).slice(-3);
}

function writeRow_(sheet, index, record) {
  var row = REGISTRY_HEADERS.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  if (index) sheet.getRange(index, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function log_(projectId, event, detail) {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  ss.getSheetByName('log').appendRow([new Date(), projectId, event, detail || '']);
}

// ---------------------------------------------------------------- GitHub

function gh_(method, path, body) {
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch('https://api.github.com' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + props.getProperty('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code === 404 && method === 'get') return null;
  if (code >= 300) throw new Error('GitHub ' + method.toUpperCase() + ' ' + path + ' -> ' + code + ': ' + text);
  return text ? JSON.parse(text) : {};
}

function repo_() { return PropertiesService.getScriptProperties().getProperty('GITHUB_REPO'); }
function baseBranch_() { return PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH') || 'main'; }

function findOpenPr_(branch) {
  var owner = repo_().split('/')[0];
  var prs = gh_('get', '/repos/' + repo_() + '/pulls?state=open&head=' +
    encodeURIComponent(owner + ':' + branch));
  return prs && prs.length ? prs[0] : null;
}

function fileSha_(path, ref) {
  var f = gh_('get', '/repos/' + repo_() + '/contents/' + path + '?ref=' + encodeURIComponent(ref));
  return f ? f.sha : null;
}

function commitAndPr_(branch, path, yaml, message, existingPrNumber, labels, kind, projectId, a, notes) {
  var r = repo_(), base = baseBranch_();
  if (!existingPrNumber) {
    var ref = gh_('get', '/repos/' + r + '/git/ref/heads/' + base);
    gh_('post', '/repos/' + r + '/git/refs', { ref: 'refs/heads/' + branch, sha: ref.object.sha });
  }
  var sha = fileSha_(path, branch);
  if (yaml === null) {
    if (!sha) throw new Error('Removal requested for ' + path + ', but the file is not on branch ' + branch +
      ' (probably never published). Curator: close any open PR for this project and mark the registry row "removed".');
    gh_('delete', '/repos/' + r + '/contents/' + path, { message: message, sha: sha, branch: branch });
  } else {
    var body = { message: message, branch: branch,
      content: Utilities.base64Encode(yaml, Utilities.Charset.UTF_8) };
    if (sha) body.sha = sha;
    gh_('put', '/repos/' + r + '/contents/' + path, body);
  }

  if (existingPrNumber) {
    gh_('post', '/repos/' + r + '/issues/' + existingPrNumber + '/comments',
      { body: 'The lead re-submitted the form (' + kind + '); this PR now has the latest answers.' });
    return gh_('get', '/repos/' + r + '/pulls/' + existingPrNumber);
  }

  var explain = {
    'new': 'New project submitted via the form. **A curator should review and merge.**',
    'verified-update': 'Update submitted through the lead\'s personal update link with the same email address. ' +
      'Merged automatically once validation passes.',
    'needs-review': 'Update submitted through the personal update link, **but with a different email address**. ' +
      'A curator should check before merging.'
  }[kind];
  var pr = gh_('post', '/repos/' + r + '/pulls', {
    title: message.replace(' via form', '') + ': ' + a.title.slice(0, 80),
    head: branch, base: base,
    body: explain + '\n\n- Project ID: `' + projectId + '`\n- Lead: ' + a.lead_name +
      '\n- Stage: ' + a.stage + (yaml === null ? '\n- **Removal requested by the lead.**' : '') +
      (notes.length ? '\n\nNotes from the form processor: ' + notes.join('; ') : '') +
      '\n\n_Opened automatically by the RDN Projects form script._'
  });
  gh_('post', '/repos/' + r + '/issues/' + pr.number + '/labels', { labels: labels });
  return pr;
}

// ---------------------------------------------------------------- email

function emailLead_(kind, removal, projectId, a, editUrl, oldEmail) {
  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  var curator = PropertiesService.getScriptProperties().getProperty('CURATOR_EMAIL');
  var linkBlock =
    '\n\nYOUR PERSONAL UPDATE LINK — please keep this email:\n' + editUrl +
    '\n\nThe link opens the form with your current answers filled in. Change what you need and ' +
    'submit again; anyone with this link can edit your entry, so please do not share it.';
  var subject, text;
  if (removal) {
    subject = 'RDN Projects: removal request received (' + projectId + ')';
    text = 'Hello ' + a.lead_name + ',\n\nWe have received your request to remove "' + a.title +
      '" (' + projectId + ') from the RDN Projects site. It will disappear from the site shortly.';
  } else if (kind === 'new') {
    subject = 'RDN Projects: thank you for sharing "' + a.title + '"';
    text = 'Hello ' + a.lead_name + ',\n\nThank you for sharing your project on the RDN Projects register. ' +
      'Your project ID is ' + projectId + '. An RDN curator will review the entry (usually within a week), ' +
      'after which it will appear at ' + site + linkBlock;
  } else if (kind === 'verified-update') {
    subject = 'RDN Projects: update received (' + projectId + ')';
    text = 'Hello ' + a.lead_name + ',\n\nThanks for updating "' + a.title + '". The changes will appear on ' +
      site + ' within a few minutes.' + linkBlock;
  } else {
    subject = 'RDN Projects: update received — awaiting check (' + projectId + ')';
    text = 'Hello ' + a.lead_name + ',\n\nWe received an update to "' + a.title + '" with a new email address. ' +
      'A curator will check it before it is published.' + linkBlock;
  }
  text += '\n\nQuestions? Reply to ' + curator + '.\n\nResponse Diversity Network';
  MailApp.sendEmail({ to: a.lead_email, subject: subject, body: text, replyTo: curator });
  if (oldEmail && normEmail_(oldEmail) !== normEmail_(a.lead_email)) {
    MailApp.sendEmail({ to: oldEmail, subject: 'RDN Projects: your entry ' + projectId + ' was edited',
      body: 'Someone used the update link for "' + a.title + '" and changed the contact email to ' +
        a.lead_email + '. If this was not you, please contact ' + curator + '.', replyTo: curator });
  }
}

function notifyCurator_(subject, body) {
  var to = PropertiesService.getScriptProperties().getProperty('CURATOR_EMAIL');
  if (to) MailApp.sendEmail(to, subject, body);
}

// ---------------------------------------------------------------- annual reminders

function sendAnnualReminders() {
  var reg = registry_();
  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  var curator = PropertiesService.getScriptProperties().getProperty('CURATOR_EMAIL');
  var yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);
  var sent = 0;
  readRows_(reg).forEach(function (r) {
    var d = r.data;
    if (!d.edit_url || d.status === 'removal-requested' || d.status === 'removed') return;
    if (new Date(d.updated) > yearAgo) return;
    if (d.last_reminder && new Date(d.last_reminder) > yearAgo) return;
    if (MailApp.getRemainingDailyQuota() < 5) return;
    MailApp.sendEmail({
      to: d.lead_email, replyTo: curator,
      subject: 'RDN Projects: is "' + d.title + '" still current?',
      body: 'Hello ' + d.lead_name + ',\n\nYour project "' + d.title + '" (' + d.project_id +
        ') on the RDN Projects register (' + site + ') has not been updated for a year.\n\n' +
        'Please take two minutes to check it is still accurate — for example its stage, or whether you are ' +
        'still looking for collaborators. If the work has stopped, choose the stage "Inactive" so others know ' +
        'the idea could be revived.\n\nYour personal update link:\n' + d.edit_url +
        '\n\nThank you!\nResponse Diversity Network'
    });
    reg.getRange(r.index, REGISTRY_HEADERS.indexOf('last_reminder') + 1).setValue(isoDate_(new Date()));
    sent++;
  });
  if (sent) log_('', 'annual-reminders', sent + ' sent');
}
