// Saved records for the merge test.
//
// Modelled on the real corpus in .data/revisions/, which is NOT used here and is
// not in the repository: its records embed the prose of a client report, and
// this project is meant to be productised. What is reproduced is the structure,
// which is the part the merge has to survive.
//
// The real corpus has 17 records across at least five sessions, saveNumber
// running 1 to 5 then resetting to 2 then to 1 then continuing at 6, two
// filenames colliding, and no baselineId on any of them. Every one of those
// shapes appears below.

// Session A. Three saves against the same starting text, so each is a
// cumulative superset of the one before and only the last should survive.
const A = [
  {
    documentId: 'fixture-doc', baselineId: 'base-a', saveNumber: 1,
    savedAt: '2026-08-15T09:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The original first line.', after: 'The edited first line.' }
    ]
  },
  {
    documentId: 'fixture-doc', baselineId: 'base-a', saveNumber: 2,
    savedAt: '2026-08-15T10:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The original first line.', after: 'The edited first line.' },
      { kind: 'replace', tag: 'P', before: 'The original second line.', after: 'The edited second line.' }
    ]
  },
  {
    documentId: 'fixture-doc', baselineId: 'base-a', saveNumber: 3,
    savedAt: '2026-08-15T11:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The original first line.', after: 'The edited first line.' },
      { kind: 'replace', tag: 'P', before: 'The original second line.', after: 'The edited second line.' },
      { kind: 'insert', tag: 'P', before: null, after: 'A brand new paragraph.' }
    ]
  }
];

// Session B. saveNumber RESTARTS at 1, which is why it cannot be used to order
// or group anything. The starting text is session A's output, so these compose
// onto A rather than superseding it.
const B = [
  {
    documentId: 'fixture-doc', baselineId: 'base-b', saveNumber: 1,
    savedAt: '2026-08-15T14:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The edited first line.', after: 'The twice edited first line.' }
    ]
  },
  {
    documentId: 'fixture-doc', baselineId: 'base-b', saveNumber: 2,
    savedAt: '2026-08-15T15:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The edited first line.', after: 'The twice edited first line.' },
      { kind: 'replace', tag: 'P', before: 'An untouched third line.', after: 'A third line, now edited.' }
    ]
  }
];

// Session C. No baselineId at all, the way every record written before
// 2026-08-16 looks. Its FROM text chains off session B, so the fold has to work
// that out from content rather than from the field.
const C = [
  {
    documentId: 'fixture-doc', saveNumber: 1,
    savedAt: '2026-08-15T18:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The twice edited first line.', after: 'The final first line.' }
    ]
  }
];

// Session D. Edits the ORIGINAL first line a second time, to a different result
// that does not contain and is not contained by session A's. Nothing can merge
// this; it has to be reported.
const D = [
  {
    documentId: 'fixture-doc', baselineId: 'base-d', saveNumber: 1,
    savedAt: '2026-08-15T20:00:00.000Z',
    edits: [
      { kind: 'replace', tag: 'P', before: 'The original first line.', after: 'A completely different first line.' }
    ]
  }
];

// Session E. Two identical inserts, which instructions.js already refuses to
// deduplicate because only the author knows which copy was meant. The fold must
// keep that refusal rather than tidying them away.
const E = [
  {
    documentId: 'fixture-doc', baselineId: 'base-e', saveNumber: 1,
    savedAt: '2026-08-15T22:00:00.000Z',
    edits: [
      { kind: 'insert', tag: 'P', before: null, after: 'Pasted twice by accident.' },
      { kind: 'insert', tag: 'P', before: null, after: 'Pasted twice by accident.' }
    ]
  }
];

export const SESSION_A = A;
export const SESSION_B = B;
export const SESSION_C = C;
export const SESSION_D = D;
export const SESSION_E = E;

// Deliberately out of chronological order, because the fold has to sort by
// savedAt itself. A caller listing a directory gets whatever order the
// filesystem hands back.
export const ALL = [].concat(C, A, E, B, D);
