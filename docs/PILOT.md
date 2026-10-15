# Pilot programme (M7)

M7 is done when **pilot users cut real jobs** (plan.md §10). This page is the kit for running it:
who to invite, what they cut, how they report, and what we measure.

**Beta:** <https://hariskhan2010.github.io/ARTSCAM/> · **Guide:** [docs/guide](guide/README.md) ·
**Reports:** [GitHub issues](https://github.com/hariskhan2010/ARTSCAM/issues/new/choose)

## Who to invite (10 people)

Aim for a mix, each with a working CNC router and time to cut at least two jobs in a month:

| Group | How many | Why |
|---|---|---|
| Ex-ArtCAM users (signs, panels, furniture) | 4 | The main audience; they know what "right" looks like |
| Calligraphy / mosque panel makers (Urdu, Arabic) | 2 | Text shaping and V-carving |
| Hobby GRBL router owners | 2 | Cheap machines, the most common setup |
| Mach3 or LinuxCNC users | 1 | Only real-controller test of those posts |
| Student or teacher | 1 | First-time CAM user, docs and safety |

Before they start, each pilot confirms they have read [Before the first cut](guide/02-before-the-first-cut.md)
and will air-cut every file first.

## What they cut

Two set jobs (so results compare across machines), then their own work:

1. **The house sign sample** (Help › Sample: House sign) in MDF or soft wood. Measure the
   outside size and the pocket depth with calipers; report both.
2. **The calligraphy plaque sample** (Help › Sample: Calligraphy plaque) with a 60° V-bit. Photo
   of the result.
3. **One relief**: the relief panel sample, or their own (rough + finish). Photo; time taken
   against the app's estimate.
4. **Their own typical job**, start to finish, in Naqsh. Note what they could not do.

## How they report

- **Problems**: Help › Report a problem (it fills in the version and browser). Attach the
  project (File › Save) and the `.nc` file. Tick "unsafe" if the machine did anything unexpected.
- **Missing features**: the "Idea" form on GitHub.
- **Each job**: a short note (comment on the pilot's tracking issue): job, machine, controller,
  bit, material, measured sizes, real time vs estimate, photo.

## Triage (weekly)

- Every new issue gets a label within a week: `unsafe`, `bug`, `idea`, plus the area.
- **`unsafe` first, always**: reproduce with the attached files, add the case to
  `fixtures/gcode/unsafe/` with a checker rule, fix, and tell the pilot before they cut again.
- Bugs that stop a pilot's job come next; ideas are collected for the M8+ plan.

## What we measure (plan.md §12)

| Metric | Target | From |
|---|---|---|
| Safety | 0 unsafe G-code files in pilot jobs | `unsafe` issues |
| Correctness | Real cut within ±0.2 mm of the design on 2D parts | Sign sample measurements |
| Time estimate | Within ±15 % of the real run | Job notes |
| Usability | Ex-ArtCAM user completes a sign job without docs in < 30 min | Timed first session (4 users) |
| Performance | 3D finishing path < 30 s on their laptop | Job notes (Simulate time) |
| Adoption | Pilots completing real jobs; issues and stars | GitHub |

**M7 is done** when at least 8 of the 10 pilots have cut the two set jobs and one job of their
own, with no open `unsafe` issue.

## Before inviting anyone

- [ ] Final product name chosen (plan.md §15: "ARTSCAM" must be replaced before launch); the beta
      address and app name updated.
- [ ] One real cut of each sample on our own machine (REMAINING_WORK "Blocked: needs you").
- [x] Labels `unsafe`, `bug`, `idea`, `triage` created (issue forms use them).
- [ ] A tracking issue per pilot.
