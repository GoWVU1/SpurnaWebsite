const ISSUE_NAMES = {
  G0100: 'Fiscal & economic policy', G0101: 'Civil rights',
  G0102: 'Environment', G0103: 'Religion', G0104: 'Health care',
  G0105: 'Agriculture', G0106: 'Education', G0107: 'Natural resources',
  G0108: 'Immigration', G0109: 'Transportation', G0110: 'Small business',
  G0111: 'Infrastructure & manufacturing', G0112: 'Foreign affairs & aid',
  G0113: 'Crime & justice', G0115: 'First responders & military',
  G0116: 'Gun policy', G0117: "Children's safety", G0118: "States' rights",
  G0119: 'Disaster relief', G0120: 'Technology & AI',
};

const STATUS = {
  scored: 'Issue scores available',
  insufficient_evidence: 'No position established',
  in_progress: 'Scoring in progress',
  ready_to_score: 'Evidence ready',
  awaiting_evidence: 'Awaiting evidence',
};

const STANCE = {
  strongly_supports: 'Strongly supports left pole',
  supports: 'Supports left pole',
  conditional_support: 'Conditionally supports left pole',
  mixed: 'Mixed statements',
  conditional_oppose: 'Conditionally opposes left pole',
  opposes: 'Opposes left pole',
  strongly_opposes: 'Strongly opposes left pole',
  no_position: 'Explicitly no position',
  unknown: 'Not established',
};

const cards = document.getElementById('cards');
const count = document.getElementById('count');
const error = document.getElementById('error');
const search = document.getElementById('search');
const state = document.getElementById('state');
const status = document.getElementById('status');
const dialog = document.getElementById('profile');
const closeProfile = document.getElementById('close-profile');
const profileName = document.getElementById('profile-name');
const profileSeat = document.getElementById('profile-seat');
const profileContent = document.getElementById('profile-content');
let candidates = [];

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function seat(candidate) {
  const office = { H: 'U.S. House', S: 'U.S. Senate', G: 'Governor' }[candidate.office] || candidate.office || 'Candidate';
  const location = candidate.district ? `${candidate.state}-${candidate.district}` : candidate.state;
  return `${office} · ${location || 'District pending'}`;
}

function scoreText(candidate) {
  if (candidate.site_position_points === null || candidate.site_position_points === undefined) {
    if (candidate.rough_band_low !== null && candidate.rough_band_low !== undefined) {
      const signed = (value) => value > 0 ? `+${value}` : String(value);
      return `${signed(candidate.rough_band_low)} to ${signed(candidate.rough_band_high)} / 50 · exploratory range`;
    }
    return candidate.score_status === 'insufficient_evidence'
      ? 'No position established' : 'No site-scale position yet';
  }
  const points = candidate.site_position_points;
  const value = `${points > 0 ? '+' : ''}${points}`;
  const source = candidate.site_position_source === 'existing_v4_lawmaker_site_score'
    ? 'v4 lawmaker position' : 'candidate estimate';
  return `${value} / 50 · ${source}`;
}

function scoreMethodText(candidate) {
  const provisional = candidate.fit_status === 'diagnostic'
    ? 'This national fit is provisional. ' : '';
  if (candidate.site_position_source === 'existing_v4_lawmaker_site_score') {
    return `${provisional}This position comes directly from the linked lawmaker's national v4 fit.`;
  }
  if (candidate.site_position_source === 'candidate_public_statement_estimate') {
    const gap = candidate.state_holdout_mae_points;
    const validation = Number.isFinite(gap)
      ? ` In the state-held-out comparison, the average gap was ${gap.toFixed(1)} points for this party.` : '';
    return `${provisional}Estimated from cited public statements on the national site's −50 to +50 scale.${validation} This estimate does not use a 119th-Congress vote-fit score.`;
  }
  if (candidate.rough_band_low !== null && candidate.rough_band_low !== undefined) {
    return `${provisional}Exploratory range from ${candidate.rough_evidence_issues} public-statement issue signal${candidate.rough_evidence_issues === 1 ? '' : 's'} on a separate common rubric, approximately mapped to the latest national display scale. That count can differ from the cited issue cards below. This is a broad comparison guide, not a calibrated confidence interval or a point score. The statement-only method had an average ${candidate.rough_validation_mae_points.toFixed(1)}-point error after mapping in 18 state-held-out linked-candidate checks.`;
  }
  return candidate.overall_lr_score_approx === null
    ? 'No overall position is available until enough cited issue positions are found.'
    : 'The original candidate score is available, but a comparable national-site position has not been validated for this candidate.';
}

function showCandidates() {
  const query = search.value.trim().toLowerCase();
  const visible = candidates.filter((candidate) => {
    if (state.value && candidate.state !== state.value) return false;
    if (status.value && candidate.score_status !== status.value) return false;
    return !query || `${candidate.display_name} ${candidate.state} ${candidate.district || ''}`.toLowerCase().includes(query);
  });
  cards.replaceChildren();
  count.textContent = `${visible.length} of ${candidates.length} ballot-verified candidates`;
  if (!visible.length) {
    cards.append(element('p', 'muted', 'No candidates match those filters.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const candidate of visible) {
    const card = element('button', 'card');
    card.type = 'button';
    const badge = element('span', `badge ${['awaiting_evidence', 'insufficient_evidence'].includes(candidate.score_status) ? 'waiting' : ''}`, STATUS[candidate.score_status] || candidate.score_status);
    card.append(badge);
    card.append(element('span', 'card-name', candidate.display_name));
    card.append(element('span', 'card-seat', `${candidate.party || 'Party unknown'} · ${seat(candidate)}`));
    const score = element('p', 'card-score', scoreText(candidate));
    score.append(element('small', '', `${candidate.cited_issue_count} cited issue positions`));
    card.append(score);
    card.addEventListener('click', () => openCandidate(candidate.candidate_id));
    fragment.append(card);
  }
  cards.append(fragment);
}

function safeSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function issueNode(issue, sources) {
  const box = element('section', 'issue');
  box.append(element('h3', '', ISSUE_NAMES[issue.issue_code] || issue.issue_code));
  box.append(element('p', 'issue-meta', `${STANCE[issue.stance] || issue.stance} · confidence ${Math.round(issue.confidence * 100)}% · emphasis ${issue.emphasis}/5`));
  if (issue.action_stance === 'unknown') {
    box.append(element('p', 'issue-meta', issue.evidence_doc_ids.length
      ? 'Legislative signal: unknown; cited public statements reviewed.'
      : 'No legislative signal or cited public statement.'));
  } else {
    box.append(element('p', 'issue-meta', `Legislative signal: ${STANCE[issue.action_stance] || issue.action_stance}`));
  }
  if (issue.stance === 'unknown' && (issue.claims || []).length) {
    box.append(element('p', 'issue-meta', 'Related statements were insufficient to establish a position:'));
  }
  for (const claim of issue.claims || []) {
    const claimBox = element('div', 'claim', claim.proposition);
    for (const citation of claim.evidence || []) {
      const source = sources[citation.doc_id];
      const url = safeSourceUrl(source && source.url);
      if (!url) continue;
      const link = element('a', 'source-link', source.title || 'Read source');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      claimBox.append(link);
    }
    box.append(claimBox);
  }
  return box;
}

async function openCandidate(candidateId) {
  profileName.textContent = 'Loading…';
  profileSeat.textContent = '';
  profileContent.replaceChildren();
  dialog.showModal();
  try {
    const response = await fetch(`/api/candidates/${candidateId}`);
    if (!response.ok) throw new Error('Profile unavailable');
    const { candidate, issues, evidence } = await response.json();
    profileName.textContent = candidate.display_name;
    profileSeat.textContent = `${candidate.party || 'Party unknown'} · ${seat(candidate)}`;
    const summary = element('div', 'profile-summary');
    summary.append(element('strong', '', scoreText(candidate)));
    summary.append(element('p', 'muted', `${candidate.cited_issue_count} cited issue positions of ${candidate.issue_count} reviewed. ${STATUS[candidate.score_status] || ''}.`));
    summary.append(element('p', 'muted', scoreMethodText(candidate)));
    if (candidate.site_position_source === 'existing_v4_lawmaker_site_score'
        && candidate.linked_member_index_code) {
      const link = element('a', 'source-link', 'Open the linked lawmaker score');
      link.href = `/lawmakers/?member=${encodeURIComponent(candidate.linked_member_index_code)}`;
      summary.append(link);
    }
    profileContent.append(summary);
    if (!issues.length) {
      profileContent.append(element('p', 'muted', 'Issue scoring has not completed for this candidate. Public statements will appear here when cited evidence is available.'));
      return;
    }
    profileContent.append(element('h3', '', 'Issue positions'));
    const list = element('div', 'issue-list');
    const ordered = [...issues].sort((a, b) => (b.evidence_doc_ids.length - a.evidence_doc_ids.length) || a.issue_code.localeCompare(b.issue_code));
    for (const issue of ordered) list.append(issueNode(issue, evidence));
    profileContent.append(list);
  } catch {
    profileContent.append(element('p', 'error', 'This profile could not be loaded right now.'));
  }
}

closeProfile.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
for (const input of [search, state, status]) input.addEventListener('input', showCandidates);

fetch('/api/candidates')
  .then((response) => { if (!response.ok) throw new Error('Candidate API unavailable'); return response.json(); })
  .then((data) => {
    candidates = data.candidates;
    const states = [...new Set(candidates.map((candidate) => candidate.state).filter(Boolean))].sort();
    for (const abbreviation of states) {
      const option = element('option', '', abbreviation);
      option.value = abbreviation;
      state.append(option);
    }
    showCandidates();
    const linked = new URLSearchParams(location.search).get('candidate');
    if (linked && candidates.some((candidate) => candidate.candidate_id === linked)) openCandidate(linked);
  })
  .catch(() => {
    count.textContent = 'Candidate directory unavailable';
    error.hidden = false;
    error.textContent = 'The database-backed candidate directory is temporarily unavailable.';
  });
