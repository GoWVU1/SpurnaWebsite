const DOMAIN_NAMES = {
  FIS: 'Fiscal policy', ECO: 'The economy', TRD: 'Trade', FOR: 'Foreign policy',
  HLT: 'Health care', EDU: 'Education', IMM: 'Immigration', CRM: 'Crime and justice',
  GUN: 'Gun policy', CIV: 'Civil rights', ELE: 'Elections', PWR: 'Government power',
  ENV: 'Environment', HOU: 'Housing and transportation',
};

const cards = document.getElementById('cards');
const count = document.getElementById('count');
const error = document.getElementById('error');
const fitNote = document.getElementById('fit-note');
const search = document.getElementById('search');
const chamber = document.getElementById('chamber');
const party = document.getElementById('party');
const role = document.getElementById('role');
const dialog = document.getElementById('profile');
const profileName = document.getElementById('profile-name');
const profileSeat = document.getElementById('profile-seat');
const profileContent = document.getElementById('profile-content');
let lawmakers = [];
let candidates = [];

function displayName(person) {
  return person.member_id === 'S000033' ? 'Bernie Sanders' : person.member_name;
}

function partyName(code) {
  return { D: 'Democratic', R: 'Republican', I: 'Independent' }[code] || code;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function points(value) {
  if (value === null || value === undefined) return 'No position available';
  return `${value > 0 ? '+' : ''}${value} / 50`;
}

function policyName(code) {
  if (DOMAIN_NAMES[code]) return DOMAIN_NAMES[code];
  const [domain, ...parts] = code.split('_');
  const detail = parts.join(' ').toLowerCase();
  return `${DOMAIN_NAMES[domain] || domain}: ${detail || code}`;
}

function showLawmakers() {
  const query = search.value.trim().toLowerCase();
  const visibleLawmakers = lawmakers.filter((person) =>
    role.value !== 'candidate'
    && (!chamber.value || person.chamber === chamber.value)
    && (!party.value || person.party === party.value)
    && (!query || `${displayName(person)} ${person.member_name}`.toLowerCase().includes(query)));
  const visibleCandidates = candidates.filter((person) =>
    role.value !== 'lawmaker'
    && (!chamber.value || person.office === chamber.value)
    && (!party.value || person.party === party.value)
    && (!query || `${person.display_name} ${person.state}`.toLowerCase().includes(query)));
  count.textContent = `${visibleLawmakers.length + visibleCandidates.length} of ${lawmakers.length + candidates.length} people`;
  cards.replaceChildren();
  if (!visibleLawmakers.length && !visibleCandidates.length) {
    cards.append(element('p', 'muted', 'No people match those filters.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const person of visibleLawmakers) {
    const card = element('button', 'card');
    card.type = 'button';
    card.append(element('span', 'badge', person.chamber === 'H' ? 'House' : 'Senate'));
    card.append(element('span', 'card-name', displayName(person)));
    card.append(element('span', 'card-seat', partyName(person.party)));
    const score = element('p', 'card-score', points(person.display_points));
    score.append(element('small', '', person.score_source === 'senate_independent_refit'
      ? 'Senate-only refit · provisional' : `${person.evidence_total ?? 0} evidence units`));
    card.append(score);
    card.addEventListener('click', () => openLawmaker(person.member_id));
    fragment.append(card);
  }
  for (const person of visibleCandidates) {
    const card = element('a', 'card');
    card.href = `/candidates/?candidate=${encodeURIComponent(person.candidate_id)}`;
    card.append(element('span', 'badge', 'Candidate'));
    card.append(element('span', 'card-name', person.display_name));
    card.append(element('span', 'card-seat', `${partyName(person.party)} · ${person.state} · ${person.office === 'S' ? 'Senate' : person.office === 'H' ? 'House' : person.office}`));
    const exact = person.site_position_source === 'existing_v4_lawmaker_site_score';
    const hasPosition = person.site_position_points !== null && person.site_position_points !== undefined;
    const hasRange = person.rough_band_low !== null && person.rough_band_low !== undefined;
    const signed = (value) => value > 0 ? `+${value}` : String(value);
    const score = element('p', 'card-score', hasPosition ? points(person.site_position_points)
      : hasRange ? `${signed(person.rough_band_low)} to ${signed(person.rough_band_high)} / 50`
        : 'No comparable position yet');
    score.append(element('small', '', hasPosition
      ? exact ? 'Linked lawmaker position' : 'Public-statement estimate · provisional'
      : hasRange ? 'Exploratory statement range · provisional'
        : `${person.cited_issue_count} cited issue positions`));
    card.append(score);
    fragment.append(card);
  }
  cards.append(fragment);
}

function scoreRow(score) {
  const row = element('section', 'issue');
  row.append(element('h3', '', policyName(score.scope_id)));
  row.append(element('p', 'issue-meta', score.score_source === 'senate_independent_refit'
    ? `${points(score.display_points)} · Senate-only refit · provisional`
    : `${points(score.display_points)} · ${score.evidence_total ?? 0} evidence units · ${score.score_status}`));
  return row;
}

async function openLawmaker(memberId) {
  profileName.textContent = 'Loading…';
  profileSeat.textContent = '';
  profileContent.replaceChildren();
  dialog.showModal();
  try {
    const response = await fetch(`/api/lawmakers/${memberId}`);
    if (!response.ok) throw new Error('Profile unavailable');
    const { lawmaker, scores, fit_status: fitStatus } = await response.json();
    profileName.textContent = displayName(lawmaker);
    profileSeat.textContent = `${lawmaker.chamber === 'H' ? 'U.S. House' : 'U.S. Senate'} · ${partyName(lawmaker.party)}`;
    const summary = element('div', 'profile-summary');
    summary.append(element('strong', '', points(lawmaker.display_points)));
    summary.append(element('p', 'muted', lawmaker.score_source === 'senate_independent_refit'
      ? 'Provisional Senate-only refit mapped approximately to the current national display scale. This is a different fit from the other lawmakers shown here.'
      : fitStatus === 'converged'
        ? 'National v4 fit. Policy area and detailed issue scores appear below.'
        : 'Provisional national v4 fit. Sampler diagnostics have not passed the release threshold.'));
    profileContent.append(summary);
    for (const [kind, heading] of [['domain', 'Policy areas'], ['subissue', 'Detailed issues']]) {
      const group = element('section', 'issue-list');
      group.append(element('h3', '', heading));
      for (const score of scores.filter((item) => item.scope_type === kind)) group.append(scoreRow(score));
      profileContent.append(group);
    }
  } catch {
    profileContent.append(element('p', 'error', 'This lawmaker profile could not be loaded right now.'));
  }
}

document.getElementById('close-profile').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
for (const input of [search, chamber, party, role]) input.addEventListener('input', showLawmakers);

fetch('/api/lawmakers')
  .then((response) => { if (!response.ok) throw new Error('Lawmaker API unavailable'); return response.json(); })
  .then((data) => {
    lawmakers = data.lawmakers;
    fitNote.textContent = data.fit_status === 'converged'
      ? 'This view uses the newest completed national v4 fit that passed sampler diagnostics. Candidate overall estimates use the same fit.'
      : 'This view uses the latest completed national v4 fit with the refreshed tweets. Its sampler diagnostics are provisional. Bernie Sanders and Angus King use an earlier Senate refit approximately mapped to the current display scale.';
    showLawmakers();
    const linked = new URLSearchParams(location.search).get('member');
    if (linked && lawmakers.some((person) => person.member_id === linked)) openLawmaker(linked);
  })
  .catch(() => {
    count.textContent = 'Lawmaker directory unavailable';
    fitNote.textContent = 'National scores are temporarily unavailable.';
    error.hidden = false;
    error.textContent = 'The database-backed lawmaker directory is temporarily unavailable.';
  });

fetch('/api/candidates')
  .then((response) => { if (!response.ok) throw new Error('Candidate API unavailable'); return response.json(); })
  .then((data) => { candidates = data.candidates; showLawmakers(); })
  .catch(() => { fitNote.textContent += ' Candidate search is temporarily unavailable.'; });
