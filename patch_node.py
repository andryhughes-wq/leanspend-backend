import io, json

PATH = "package.json"
with io.open(PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

eng = data.get("engines", {})
old = eng.get("node", "(none)")
eng["node"] = "22.x"
data["engines"] = eng

with io.open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("[ok] engines.node:", old, "->", eng["node"])
print("[done] package.json updated")
