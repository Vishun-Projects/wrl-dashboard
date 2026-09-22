import zipfile
import re
import xml.etree.ElementTree as ET

with zipfile.ZipFile('2022 to 2025 FINAL.xlsx') as z:
    with z.open('xl/worksheets/sheet1.xml') as f:
        chunk = f.read(25000).decode('utf-8', errors='ignore')

    row1_match = re.search(r'<row[^>]*r="1"[^>]*>(.*?)</row>', chunk)
    if not row1_match:
        row1_match = re.search(r'<row[^>]*>(.*?)</row>', chunk)
    
    row1 = row1_match.group(1) if row1_match else ''
    cell_pattern = re.compile(r'<c\s+r="([A-Z0-9]+)"(?:\s+s="[^"]*")?(?:\s+t="([^"]*)")?[^>]*>(?:<v>([^<]*)</v>)?')
    cells = cell_pattern.findall(row1)
    
    s_indices = [int(v) for r, t, v in cells if t == 's' and v.isdigit()]
    max_idx = max(s_indices) if s_indices else 0
    print(f'Found {len(cells)} cells in header row, max string index: {max_idx}')

    strings = {}
    with z.open('xl/sharedStrings.xml') as sf:
        count = 0
        for event, elem in ET.iterparse(sf, events=('end',)):
            if elem.tag.endswith('si'):
                t_elem = elem.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                strings[count] = t_elem.text if t_elem is not None and t_elem.text else ''
                count += 1
                elem.clear()
                if count > max_idx + 10:
                    break

    headers = []
    for r, t, v in cells:
        val = strings.get(int(v), v) if t == 's' and v.isdigit() else v
        headers.append((r, val))

    print('\nCOLUMNS:')
    for r, h in headers:
        print(f'  {r}: {h}')
