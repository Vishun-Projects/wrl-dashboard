import zipfile
import re

with zipfile.ZipFile('2022 to 2025 FINAL.xlsx') as z:
    raw_ss = z.read('xl/sharedStrings.xml')
    sis = raw_ss.split(b'</si>')
    strings = []
    for si in sis[:-1]:
        start = si.find(b'<t')
        if start == -1:
            strings.append('')
            continue
        val_start = si.find(b'>', start) + 1
        val_end = si.find(b'</t>', val_start)
        if val_end != -1:
            strings.append(si[val_start:val_end].decode('utf-8', errors='replace'))
        else:
            strings.append('')

    with z.open('xl/worksheets/sheet1.xml') as f:
        chunk = f.read(50000)
        rows = chunk.split(b'</row>')
        col_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 
                   'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15}
        for r_xml in rows[1:10]:
            vals = ['' for _ in range(16)]
            for c in re.finditer(rb'<c\s+r="([A-P])[0-9]+"(.*?)(?:><v>([^<]*)</v>|</c>)', r_xml):
                col = c.group(1).decode('ascii')
                attrs = c.group(2)
                v = c.group(3)
                if not v:
                    continue
                v_str = v.decode('ascii', errors='ignore')
                if b't="s"' in attrs and v_str.isdigit():
                    vals[col_map[col]] = strings[int(v_str)].strip()
                else:
                    vals[col_map[col]] = v_str.strip()
            print("Serial:", vals[3], "| Material:", vals[2], "| Customer:", vals[6], "| Subgroup:", vals[7], "| Start:", vals[12], "| End:", vals[13])
