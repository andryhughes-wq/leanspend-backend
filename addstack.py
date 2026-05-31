with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\index.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Make the catch block show the FULL error including stack trace
old = "logger.error('\u00e2\u0152 Failed to start LeanSpend:', err.message);"
new = "logger.error('Failed to start LeanSpend:', err.message); logger.error('STACK:', err.stack);"

# Try a more flexible match - find the Failed to start line
import re
content = re.sub(
    r"logger\.error\([^\n]*Failed to start LeanSpend:[^\n]*err\.message\);",
    "logger.error('Failed to start LeanSpend:', err.message, err.stack);",
    content
)

with open(r'C:\Users\andry\OneDrive\Desktop\LeanSpend\leanspend\src\index.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Added stack trace logging')
