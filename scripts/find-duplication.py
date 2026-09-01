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
