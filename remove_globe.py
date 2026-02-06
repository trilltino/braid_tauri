import os

path = r'c:\Users\isich\braid_tauri\xf_tauri\ui\index.html'

try:
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    in_svg = False
    found = False
    
    for line in lines:
        stripped = line.strip()
        
        # Start of SVG block
        if '<svg viewBox="0 0 24 24"' in line and 'auth-header-brand' not in line: 
            # (ensure we are inside the brand block logic or roughly there. 
            # Actually, just matching the unique SVG tag signature is safe enough here.)
            in_svg = True
            found = True
            continue
            
        if in_svg:
            if '</svg>' in line:
                in_svg = False
            continue
            
        new_lines.append(line)

    if found:
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
        print("Successfully removed SVG block")
    else:
        print("SVG block start not found")
        # specific debug
        for i, line in enumerate(lines):
            if 'svg' in line:
                print(f"Line {i+1}: {repr(line)}")
            if i > 100: break 

except Exception as e:
    print(f"Error: {e}")
