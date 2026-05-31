import io, re

PATH = r"src\index.js"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
orig = src

# 1) Remove the process-level diagnostics block (between the markers, inclusive)
src = re.sub(
    r"// === TEMP CRASH DIAGNOSTICS.*?// === END CRASH DIAGNOSTICS ===\n+",
    "",
    src,
    flags=re.DOTALL,
)

# 2) Remove the four FULL ERROR DUMP console.error lines
lines = src.split("\n")
kept = [ln for ln in lines if "FULL ERROR DUMP" not in ln]
removed = len(lines) - len(kept)
src = "\n".join(kept)

# 3) Revert the delayed exit back to a plain process.exit(1)
src = src.replace(
    "setTimeout(() => process.exit(1), 750) /* DELAYED EXIT for flush */",
    "process.exit(1)",
)

if src != orig:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[done] cleaned index.js (removed {removed} dump lines + diagnostics block)")
else:
    print("[skip] nothing to clean - already removed")
