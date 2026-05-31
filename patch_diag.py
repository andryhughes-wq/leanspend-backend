import io

PATH = r"src\index.js"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

changed = False

# 1) Process-level handlers - catch async errors try/catch never sees
#    (e.g. app.listen error on bad/duplicate PORT, rejected promises).
#    Delayed exit so output flushes to Railway's log pipe before exit.
if "TEMP CRASH DIAGNOSTICS" not in src:
    guard = (
        "// === TEMP CRASH DIAGNOSTICS (remove after debugging) ===\n"
        "process.on('uncaughtException', (e) => {\n"
        "  console.error('UNCAUGHT EXCEPTION ==>', (e && e.stack) || e);\n"
        "  setTimeout(() => process.exit(1), 750);\n"
        "});\n"
        "process.on('unhandledRejection', (r) => {\n"
        "  console.error('UNHANDLED REJECTION ==>', (r && r.stack) || r);\n"
        "  setTimeout(() => process.exit(1), 750);\n"
        "});\n"
        "// === END CRASH DIAGNOSTICS ===\n\n"
    )
    src = guard + src
    changed = True
    print("[ok] prepended process-level handlers")
else:
    print("[skip] process-level handlers already present")

# 2) Dump the FULL error in the catch (message is empty, so dump
#    type/value/stack/own-props), then delay the exit so it flushes.
if "FULL ERROR DUMP" not in src:
    out = []
    inserted = False
    for line in src.split("\n"):
        out.append(line)
        if (not inserted) and ("Failed to start LeanSpend" in line):
            ind = line[:len(line) - len(line.lstrip())]
            out.append(ind + "console.error('=== FULL ERROR DUMP (type) ===', typeof err);")
            out.append(ind + "console.error('=== FULL ERROR DUMP (value) ===', err);")
            out.append(ind + "console.error('=== FULL ERROR DUMP (stack) ===', err && err.stack);")
            out.append(ind + "try { console.error('=== FULL ERROR DUMP (json) ===', JSON.stringify(err, Object.getOwnPropertyNames(Object(err)))); } catch (_e) {}")
            inserted = True
    src = "\n".join(out)
    if inserted:
        changed = True
        print("[ok] inserted full error dump after 'Failed to start LeanSpend'")
        idx = src.find("FULL ERROR DUMP (json)")
        tail = src[idx:]
        if "process.exit(1)" in tail and "DELAYED EXIT" not in tail:
            tail = tail.replace(
                "process.exit(1)",
                "setTimeout(() => process.exit(1), 750) /* DELAYED EXIT for flush */",
                1,
            )
            src = src[:idx] + tail
            print("[ok] delayed the catch-block process.exit(1) to allow flush")
        else:
            print("[warn] no process.exit(1) found right after dump - check manually")
    else:
        print("[warn] 'Failed to start LeanSpend' line not found - catch NOT patched; check wording/var name")

if changed:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print("[done] src/index.js updated")
else:
    print("[done] nothing to change")
