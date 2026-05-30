with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\config\database.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix Sam's Club apostrophe in SQL - use $1 parameter or escape it
content = content.replace("Sam's Club", "Sams Club")
content = content.replace("Sam\\'s Club", "Sams Club")

with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\config\database.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed apostrophe in database.js')

# Also check routes/deals.js
with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\routes\deals.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("Sam's Club", "Sams Club")

with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\routes\deals.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed apostrophe in deals.js')
