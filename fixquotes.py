with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\config\database.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('"Sams Club"', "'Sams Club'")

with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\config\database.js', 'w', encoding='utf-8') as f:
    f.write(content)

if '"Sams Club"' in content:
    print('STILL HAS DOUBLE QUOTES - fix failed')
else:
    print('FIXED - Sams Club now uses single quotes')
