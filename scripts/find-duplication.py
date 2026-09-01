#!/usr/bin/env python3
"""Rank what the two product families are still solving twice.

    python3 scripts/find-duplication.py

Run it after any port work. It found the PRNG being carried thirteen times and
the Godot export plugin being byte-identical bar its comments, both of which are
now single sources; it is cheap to re-run and the list only stays honest if
somebody does.

Pair every Storylets source file with its Patterplay opposite number and rank
by how much the same problem is being solved twice.

Method, and its limits. Family identifiers are normalised away, comments
stripped, and the remainder compared as a token stream. HIGH similarity is
strong evidence of duplication. LOW similarity is NOT evidence of its absence:
two files can solve one problem in two ways and share not a token, which is
exactly the complaint. So this ranks what to READ, and nothing here is a
conclusion until both files have been read."""
import re, sys, difflib, pathlib, itertools

ROOT = pathlib.Path("/Volumes/Data/GitHub")

SUBS = [
    (r'StoryletStudio\.StoryletEngine|Patterkit\.Patterplay', 'NS'),
    (r'\bstorylets\b|\bpatter\b|\bpatterkit\b|\bstorylet-studio\b', 'ns'),
    (r'Storylet(?:Engine)?|Patterplay|Patter', 'F'),
    (r'storylet_?engine|patterplay|storylet|patter', 'f'),
    # domain nouns that name the same slot in each product
    (r'\bcards?\b|\bnodes?\b', 'ITEM'), (r'\bdecks?\b|\bscenes?\b', 'GROUP'),
    (r'\bhands?\b|\bflows?\b', 'SLOT'), (r'\bboxe?s?\b|\bblocks?\b', 'BOX'),
]

def norm(path):
    try: text = path.read_text(errors="replace")
    except Exception: return []
    out = []
    for line in text.split("\n"):
        line = re.sub(r'//.*|#(?!include|pragma|region).*', '', line)
        if not line.strip(): continue
        for a, b in SUBS: line = re.sub(a, b, line, flags=re.I)
        out.append(line.strip())
    body = "\n".join(out)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    return re.findall(r'[A-Za-z_][A-Za-z_0-9]*|[^\sA-Za-z_0-9]', body)

def key(p, base):
    """A comparable name: strip the family prefix and the extension case."""
    n = p.stem
    for a, b in [(r'^Storylet(Engine)?', ''), (r'^Patterplay', ''), (r'^Patter', ''),
                 (r'^storylet_?engine_?', ''), (r'^patterplay_?', ''), (r'^patter_?', '')]:
        n = re.sub(a, b, n, flags=re.I)
    return (n.lower().replace("_", "") or p.stem.lower(), p.suffix)

def collect(base, globs, skip):
    out = {}
    for g in globs:
        for p in (ROOT / base).rglob(g):
            s = str(p)
            if any(k in s for k in skip): continue
            out.setdefault(key(p, base), []).append(p)
    return out

PAIRS = [
  ("Godot",  "storylets/ports/godot", "patter/ports/godot", ["*.gd"],
   [".godot/", "/test/", "demo"]),
  ("Unity",  "storylets/ports/unity", "patter/ports/unity", ["*.cs"],
   ["/obj/", "/bin/", "TestHost", "Samples~", "/Expr/"]),
  ("Unreal", "storylets/ports/unreal", "patter/ports/unreal", ["*.h", "*.cpp"],
   ["Intermediate", "Binaries", "TestHost", "Demo", "/Expr/"]),
  ("JS",     "storylets/packages", "patter/packages", ["*.ts"],
   ["node_modules", "/test/", ".test.ts", "dist/", "patterpad", "studio", "website"]),
  # The repo's OWN tooling, which the scan ignored until 2026-09-01 and should not
  # have: the release scripts and workflows are written by the same hands, solve the
  # same problem twice, and drift the same way. The release guard was carried from one
  # repo to the other on the day this line was added, and a bug in it had to be fixed
  # in both copies within the hour. A duplication scanner that cannot see the
  # duplication its own author is creating is not much of a scanner.
  ("Tooling", "storylets/scripts", "patter/scripts", ["*.mjs", "*.sh", "*.py"],
   ["node_modules"]),
  ("CI",     "storylets/.github/workflows", "patter/.github/workflows", ["*.yml"],
   []),
]

# --- functions ---------------------------------------------------------------
# The file-level scan pairs whole files by name, so it cannot see a function
# duplicated INSIDE one - and that is where the duplication has actually been
# hiding. @wildwinter/scoperegistry's defaultFor was written out three more
# times inside one 2000-line engine.ts, agreeing on six cases and differing on
# the seventh, and no scan reported a thing. Nor can it see a pair whose files
# were RENAMED (logger.gd against state_logger.gd), because the names key the
# comparison.
#
# So: chop every file into functions, normalise the family names away, and
# compare every function against every other one ACROSS the whole estate, not
# just against its opposite number. Quadratic, but the corpus is small enough
# (a few thousand functions) that it costs seconds.

FUNC_PATTERNS = [
    # name-capturing, one per language. Bodies run to the next definition at the
    # same indent or shallower, which is good enough for a similarity scan.
    (".ts",  re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)", re.M)),
    # The access modifier is REQUIRED, not optional. Without it this pattern matched
    # every 2-space-indented `name(` in the file - 264 of them in one engine.ts,
    # nearly all statements - which chopped the real functions into fragments below
    # the token floor, so the scan reported nothing and looked like it had checked.
    (".ts",  re.compile(r"^\s{2}(?:private|public|protected|static|async|readonly)\s+(?:static\s+)?(?:async\s+)?(\w+)\s*\(", re.M)),
    (".gd",  re.compile(r"^(?:static\s+)?func\s+(\w+)", re.M)),
    (".cs",  re.compile(r"^\s*(?:public|private|internal|protected).*?\s(\w+)\s*\(", re.M)),
    (".h",   re.compile(r"^\s*(?:static\s+|inline\s+|virtual\s+)*[\w:<>&*\s]+?\s(\w+)\s*\([^;]*$", re.M)),
    (".cpp", re.compile(r"^[\w:<>&*\s]+?\s([\w:]+)\s*\([^;]*$", re.M)),
]

def functions(path):
    """(name, token-list) for each function-ish region of a file."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    pats = [p for ext, p in FUNC_PATTERNS if path.suffix == ext]
    if not pats: return []
    # `if (`, `for (`, `while (` and friends look exactly like a call-shaped
    # definition to these patterns. Excluding them by name is cruder than parsing
    # and enough: a control keyword is never a function name.
    KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "do", "else",
                "using", "lock", "foreach", "match", "assert", "await", "new"}
    marks = sorted({(m.start(), m.group(1)) for p in pats for m in p.finditer(text)
                    if m.group(1) not in KEYWORDS})
    out = []
    for i, (pos, name) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        body = text[pos:end]
        toks = norm_text(body)
        if len(toks) >= 60:            # a one-liner pair proves nothing
            out.append((name, toks))
    return out

def norm_text(t):
    t = re.sub(r"(?m)^\s*(//|#).*$", "", t)
    for a, b in SUBS:
        t = re.sub(a, b, t, flags=re.I)
    return re.findall(r"[A-Za-z_][A-Za-z_0-9]*|[^\s\w]", t)

rows = []
for label, a, b, globs, skip in PAIRS:
    A, B = collect(a, globs, skip), collect(b, globs, skip)
    for k in sorted(set(A) & set(B)):
        for pa, pb in itertools.product(A[k], B[k]):
            ta, tb = norm(pa), norm(pb)
            if len(ta) < 40 or len(tb) < 40: continue
            r = difflib.SequenceMatcher(None, ta, tb).ratio()
            rows.append((r, label, min(len(ta), len(tb)), str(pa.relative_to(ROOT)), str(pb.relative_to(ROOT))))

# A vendored pair is IDENTICAL on purpose: it is one source, copied. Counting it
# as duplication would bury the real findings under the work already done, and
# would make the list get worse the more of it you fix.
def vendored(path):
    # Read the banner rather than guessing from the path. The port sources happen to
    # live under an expr/ directory, but the shared TOOLING lands in scripts/ beside
    # files nobody vendored, and a path heuristic silently counted those as duplication
    # the day they were shared. The banner is the actual mark of a generated file.
    try:
        with open(ROOT / path, encoding="utf-8", errors="ignore") as fh:
            head = fh.read(400)
    except OSError:
        return False
    return "vendored from expr/" in head

shared = [r for r in rows if vendored(r[3])]
rows = [r for r in rows if not vendored(r[3])]

rows.sort(key=lambda x: -(x[0] * x[2]))   # rank by similarity WEIGHTED by size
print(f"{len(shared)} vendored pairs (one shared source each) excluded; "
      f"{sum(r[2] for r in shared)} tokens no longer written twice.\n")
print(f"{'sim':>5} {'plat':<7} {'tokens':>7}  file")
for r, label, n, pa, pb in rows:
    if r < 0.30: continue
    print(f"{r*100:4.0f}% {label:<7} {n:7}  {pathlib.Path(pa).name}")
    print(f"{'':22}  SL {pa}")
    print(f"{'':22}  PK {pb}")

# --- the function-level pass -------------------------------------------------
# Every function against every other, across both estates. A file-level pair is
# already reported above, so this only prints what that pass CANNOT see: two
# functions in files that were never compared, because they have different names
# or live in the same file.
if "--functions" in sys.argv or "--all" in sys.argv:
    corpus = []                       # (label, path, name, tokens)
    for label, a, b, globs, skip in PAIRS:
        for base in (a, b):
            for g in globs:
                for path in (ROOT / base).rglob(g):
                    if any(k in str(path) for k in skip): continue
                    if vendored(str(path.relative_to(ROOT))): continue
                    for name, toks in functions(path):
                        corpus.append((label, str(path.relative_to(ROOT)), name, toks))

    seen = set()
    hits = []
    for i in range(len(corpus)):
        li, pi, ni, ti = corpus[i]
        for j in range(i + 1, len(corpus)):
            lj, pj, nj, tj = corpus[j]
            if li != lj: continue                       # same language only
            if abs(len(ti) - len(tj)) > max(len(ti), len(tj)) * 0.5: continue   # cheap reject
            r = difflib.SequenceMatcher(None, ti, tj).ratio()
            if r < 0.85: continue
            key = (pi, ni, pj, nj)
            if key in seen: continue
            seen.add(key)
            hits.append((r, li, min(len(ti), len(tj)), pi, ni, pj, nj))

    hits.sort(key=lambda x: -(x[0] * x[2]))
    print(f"\n\n{len(hits)} function pairs at 85% or above that the file scan cannot see")
    print("(same language; a pair whose FILES are already reported above is still worth")
    print(" listing here, because the duplicated part may be a small piece of a big file)\n")
    print(f"{'sim':>5} {'plat':<7} {'tokens':>7}  function")
    LIMIT = 40
    if len(hits) > LIMIT:
        # Say what is being withheld. A truncated list that does not admit it reads as a
        # complete one, and this pass exists because a silent omission is how four copies
        # of one function stayed invisible.
        print(f"  (showing the top {LIMIT} by similarity x size; {len(hits) - LIMIT} more not listed"
              f" - pass --all-functions for every one)\n")
    shown = hits if "--all-functions" in sys.argv else hits[:LIMIT]
    for r, label, n, pi, ni, pj, nj in shown:
        print(f"{r*100:4.0f}% {label:<7} {n:7}  {ni} / {nj}")
        print(f"{'':22}  A {pi}")
        print(f"{'':22}  B {pj}")
